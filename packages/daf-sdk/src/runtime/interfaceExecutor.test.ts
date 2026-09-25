import { describe, it, expect } from 'vitest';
import { collectRoomFiles, type InterfaceDef, type InterfaceMessage, type InterfaceParticipant } from './interfaceExecutor';

const rooms: InterfaceDef[] = [
  { id: 'A', name: 'Room A', participantIds: ['p1', 'p2'], type: 'text+data' },
  { id: 'B', name: 'Room B', participantIds: ['p1', 'p2'], type: 'text' },
  { id: 'C', name: 'Room C', participantIds: ['p2'] }, // no type: Text + Data by default
];

const png = { resourceId: 'r_png', name: 'chart.png', mediaType: 'image/png', data: 'cG5n' };
const pdf = { resourceId: 'r_pdf', name: 'report.pdf', mediaType: 'application/pdf', data: 'JVBERg==' };

function msg(interfaceId: string, attachments?: any[]): InterfaceMessage {
  const room = rooms.find((r) => r.id === interfaceId)!;
  return {
    role: 'assistant', content: 'x', timestamp: '', source: 'interfaces',
    interfaceId, interfaceName: room.name, participantId: 'p0', participantName: 'System',
    ...(attachments ? { attachments } : {}),
  };
}

const claude: InterfaceParticipant = { id: 'p1', name: 'Claude', model: 'claude-sonnet-5', interfaceIds: ['A', 'B'] };
const grok: InterfaceParticipant = { id: 'p2', name: 'Grok', model: 'grok-4', interfaceIds: ['A', 'B', 'C'] };

describe('collectRoomFiles', () => {
  it('gives a participant the real file from a Text + Data room they belong to', () => {
    const parts = collectRoomFiles(claude, rooms, [msg('A', [png])]);
    expect(parts).toEqual([
      { type: 'text', text: '[Room A] Attached file: chart.png' },
      { type: 'file', data: 'cG5n', mediaType: 'image/png' },
    ]);
  });

  it('never sends files from a Text room or from rooms the participant is not in', () => {
    expect(collectRoomFiles(claude, rooms, [msg('B', [png])])).toEqual([]);
    expect(collectRoomFiles(claude, rooms, [msg('C', [png])])).toEqual([]);
  });

  it('treats a room with no type as Text + Data', () => {
    expect(collectRoomFiles(grok, rooms, [msg('C', [png])])).toHaveLength(2);
  });

  it("gives a note instead of the file when the participant's model can't read the type", () => {
    const parts = collectRoomFiles(grok, rooms, [msg('A', [pdf])]); // xAI has no plain PDF file parts
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toContain("can't view this file type");
  });

  it('sends each file once even if several messages carry it', () => {
    expect(collectRoomFiles(claude, rooms, [msg('A', [png]), msg('A', [png])])).toHaveLength(2);
  });
});
