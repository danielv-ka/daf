import { Client } from '@notionhq/client';
import type { DAFStorageAdapter } from '../types';

// Notion OAuth 2.0 configuration
const NOTION_CLIENT_ID = process.env.NOTION_CLIENT_ID || '';
const NOTION_CLIENT_SECRET = process.env.NOTION_CLIENT_SECRET || '';
const NOTION_REDIRECT_URI = process.env.NOTION_REDIRECT_URI || 'http://localhost:3000/api/integrations/notion/callback';

/**
 * Generate Notion OAuth authorization URL
 * Notion OAuth supports page-level permissions through the authorization flow
 */
export function getNotionAuthUrl(userId: string): string {
  const authUrl = new URL('https://api.notion.com/v1/oauth/authorize');
  authUrl.searchParams.set('client_id', NOTION_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('owner', 'user');
  authUrl.searchParams.set('redirect_uri', NOTION_REDIRECT_URI);
  authUrl.searchParams.set('state', userId); // Pass userId to retrieve after callback

  return authUrl.toString();
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeNotionCode(code: string): Promise<{
  accessToken: string;
  workspaceId: string;
  workspaceName: string;
  botId: string;
}> {
  const encoded = Buffer.from(`${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`).toString('base64');

  const response = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${encoded}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: NOTION_REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange Notion code: ${error}`);
  }

  const data = await response.json() as any;

  return {
    accessToken: data.access_token,
    workspaceId: data.workspace_id,
    workspaceName: data.workspace_name,
    botId: data.bot_id,
  };
}

/**
 * Get Notion access token for a user
 * Note: Notion tokens don't expire, so no refresh needed
 */
export async function getNotionAccessToken(
  userId: string,
  adapter: DAFStorageAdapter
): Promise<string> {
  const integration = await adapter.getNotionIntegration(userId);

  if (!integration) {
    throw new Error('Notion integration not found. Please connect your Notion account.');
  }

  return integration.accessToken;
}

/**
 * Extract page ID from Notion URL
 */
export function extractPageIdFromUrl(url: string): string | null {
  // Notion URLs can be in formats:
  // https://www.notion.so/Page-Title-abc123
  // https://www.notion.so/workspace/Page-Title-abc123
  // https://www.notion.so/Page-Title-abc123?source=copy_link
  // The page ID is the last part (32 chars, usually with hyphens), ignoring query parameters
  // Remove query parameters first
  const urlWithoutQuery = url.split('?')[0];
  const match = urlWithoutQuery.match(/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);

  if (match) {
    // Remove hyphens and format as UUID
    const id = match[1].replace(/-/g, '');
    return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
  }

  return null;
}

/**
 * Extract database ID from Notion URL
 * Database URLs are similar to page URLs but may include view parameter
 */
export function extractDatabaseIdFromUrl(url: string): string | null {
  // Database URLs can be in formats:
  // https://www.notion.so/workspace/database-id?v=view-id
  // https://www.notion.so/database-id?v=view-id
  // https://www.notion.so/Database-Title-database-id
  // The database ID is extracted the same way as page ID
  return extractPageIdFromUrl(url);
}

/**
 * Get page title from Notion page
 */
export async function getNotionPageTitle(
  pageId: string,
  accessToken: string
): Promise<string | null> {
  try {
    const notion = new Client({ auth: accessToken });
    const page = await notion.pages.retrieve({ page_id: pageId }) as any;

    // Extract title from properties
    if (page.properties) {
      // Look for title property (it's usually the first property or named "title", "Name", etc.)
      for (const prop of Object.values(page.properties)) {
        if ((prop as any).type === 'title' && (prop as any).title) {
          const titleArray = (prop as any).title;
          if (titleArray.length > 0 && titleArray[0].plain_text) {
            return titleArray[0].plain_text;
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Error fetching Notion page title:', error);
    return null;
  }
}

/**
 * Read content from a Notion page
 */
export async function readNotionPage(
  pageId: string,
  accessToken: string
): Promise<string> {
  const notion = new Client({ auth: accessToken });

  // Helper function to recursively get block content with children
  async function getBlockContent(blockId: string, indentLevel: number = 0): Promise<string> {
    const blocks = await notion.blocks.children.list({
      block_id: blockId,
    });

    let content = '';
    const indent = '  '.repeat(indentLevel); // 2 spaces per indent level

    for (const block of blocks.results) {
      if ('type' in block) {
        const blockType = block.type;

        // Handle different block types
        if (blockType === 'paragraph' && 'paragraph' in block) {
          const paragraph = block.paragraph;
          if (paragraph.rich_text && paragraph.rich_text.length > 0) {
            content += indent + extractTextFromRichText(paragraph.rich_text) + '\n';
          } else {
            content += '\n'; // Empty paragraph = blank line
          }
        } else if (blockType === 'heading_1' && 'heading_1' in block) {
          const heading = block.heading_1;
          if (heading.rich_text) {
            content += indent + '# ' + extractTextFromRichText(heading.rich_text) + '\n';
          }
        } else if (blockType === 'heading_2' && 'heading_2' in block) {
          const heading = block.heading_2;
          if (heading.rich_text) {
            content += indent + '## ' + extractTextFromRichText(heading.rich_text) + '\n';
          }
        } else if (blockType === 'heading_3' && 'heading_3' in block) {
          const heading = block.heading_3;
          if (heading.rich_text) {
            content += indent + '### ' + extractTextFromRichText(heading.rich_text) + '\n';
          }
        } else if (blockType === 'bulleted_list_item' && 'bulleted_list_item' in block) {
          const item = block.bulleted_list_item;
          if (item.rich_text) {
            content += indent + '• ' + extractTextFromRichText(item.rich_text) + '\n';
          }
          // Get nested children if has_children is true
          if (block.has_children && 'id' in block) {
            content += await getBlockContent(block.id, indentLevel + 1);
          }
        } else if (blockType === 'numbered_list_item' && 'numbered_list_item' in block) {
          const item = block.numbered_list_item;
          if (item.rich_text) {
            content += indent + '1. ' + extractTextFromRichText(item.rich_text) + '\n';
          }
          // Get nested children if has_children is true
          if (block.has_children && 'id' in block) {
            content += await getBlockContent(block.id, indentLevel + 1);
          }
        } else if (blockType === 'to_do' && 'to_do' in block) {
          const todo = block.to_do;
          const checkbox = todo.checked ? '[x]' : '[ ]';
          if (todo.rich_text) {
            content += indent + `- ${checkbox} ` + extractTextFromRichText(todo.rich_text) + '\n';
          }
          // Get nested children if has_children is true
          if (block.has_children && 'id' in block) {
            content += await getBlockContent(block.id, indentLevel + 1);
          }
        } else if (blockType === 'toggle' && 'toggle' in block) {
          const toggle = block.toggle;
          if (toggle.rich_text) {
            content += indent + '▸ ' + extractTextFromRichText(toggle.rich_text) + '\n';
          }
          // Get nested children (the content inside the toggle)
          if (block.has_children && 'id' in block) {
            content += await getBlockContent(block.id, indentLevel + 1);
          }
        } else if (blockType === 'code' && 'code' in block) {
          const code = block.code;
          if (code.rich_text) {
            content += indent + '```\n' + extractTextFromRichText(code.rich_text) + '\n```\n';
          }
        } else if (blockType === 'quote' && 'quote' in block) {
          const quote = block.quote;
          if (quote.rich_text) {
            content += indent + '> ' + extractTextFromRichText(quote.rich_text) + '\n';
          }
        } else if (blockType === 'callout' && 'callout' in block) {
          const callout = block.callout;
          if (callout.rich_text) {
            const icon = callout.icon && 'emoji' in callout.icon ? callout.icon.emoji : '📌';
            content += indent + `${icon} ` + extractTextFromRichText(callout.rich_text) + '\n';
          }
        } else if (blockType === 'divider') {
          content += indent + '---\n';
        } else if (blockType === 'child_page' && 'child_page' in block && 'id' in block) {
          const childPage = block.child_page;
          const title = childPage.title || 'Untitled';
          const url = `https://www.notion.so/${block.id.replace(/-/g, '')}`;
          content += indent + `${title} (${url})\n`;
        } else if (blockType === 'child_database' && 'child_database' in block && 'id' in block) {
          const childDb = block.child_database as any;
          const title = childDb.title || 'Untitled Database';
          const url = `https://www.notion.so/${block.id.replace(/-/g, '')}`;
          content += indent + `[Database] ${title} (${url})\n`;
        }
      }
    }

    return content;
  }

  // Start reading from the page
  return await getBlockContent(pageId);
}

/**
 * Helper function to extract plain text from Notion rich text array
 */
function extractTextFromRichText(richText: any[]): string {
  return richText.map(text => {
    // If it's a mention, include the URL in parentheses
    if (text.type === 'mention' && text.mention) {
      const plainText = text.plain_text;
      if (text.mention.type === 'page') {
        const pageId = text.mention.page?.id;
        if (pageId) {
          const url = `https://www.notion.so/${pageId.replace(/-/g, '')}`;
          return `${plainText} (${url})`;
        }
      }
      // For other mention types, just return plain text
      return plainText;
    }
    // For regular text, just return plain_text
    return text.plain_text;
  }).join('');
}

/**
 * Replace entire content of a Notion page
 */
export async function writeNotionPage(
  pageId: string,
  content: string,
  accessToken: string
): Promise<void> {
  const notion = new Client({ auth: accessToken });

  // Get all existing blocks
  const existingBlocks = await notion.blocks.children.list({
    block_id: pageId,
  });

  // Delete all existing blocks
  for (const block of existingBlocks.results) {
    if ('id' in block) {
      await notion.blocks.delete({
        block_id: block.id,
      });
    }
  }

  // Parse content into lines and create new blocks
  const lines = content.split('\n').filter(line => line.trim());
  const blocks: any[] = [];

  for (const line of lines) {
    if (line.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
        },
      });
    } else if (line.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: line.slice(3) } }],
        },
      });
    } else if (line.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: line.slice(4) } }],
        },
      });
    } else if (line.startsWith('• ') || line.startsWith('- ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
        },
      });
    } else if (line.match(/^\d+\.\s/)) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{ type: 'text', text: { content: line.replace(/^\d+\.\s/, '') } }],
        },
      });
    } else {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: line } }],
        },
      });
    }
  }

  // Append new blocks in batches of 100 (Notion API limit)
  const NOTION_BLOCK_BATCH_LIMIT = 100;
  for (let i = 0; i < blocks.length; i += NOTION_BLOCK_BATCH_LIMIT) {
    await notion.blocks.children.append({
      block_id: pageId,
      children: blocks.slice(i, i + NOTION_BLOCK_BATCH_LIMIT),
    });
  }
}

/**
 * Selectively replace blocks in a Notion page by block range
 * Note: Notion doesn't support character-level indices, so we work with block indices
 */
export async function selectiveUpdateNotionPage(
  pageId: string,
  content: string,
  startBlockIndex: number,
  endBlockIndex: number,
  accessToken: string
): Promise<void> {
  const notion = new Client({ auth: accessToken });

  // Get all blocks in the page
  const response = await notion.blocks.children.list({
    block_id: pageId,
  });

  const allBlocks = response.results as any[];

  // Validate block indices
  if (startBlockIndex < 0 || endBlockIndex > allBlocks.length) {
    throw new Error(`Invalid block range: startBlockIndex=${startBlockIndex}, endBlockIndex=${endBlockIndex}, total blocks=${allBlocks.length}`);
  }

  // Delete blocks in the specified range
  for (let i = startBlockIndex; i < endBlockIndex && i < allBlocks.length; i++) {
    await notion.blocks.delete({
      block_id: allBlocks[i].id,
    });
  }

  // Parse new content into blocks
  const lines = content.split('\n').filter(line => line.trim());
  const newBlocks: any[] = [];

  for (const line of lines) {
    if (line.startsWith('# ')) {
      newBlocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
        },
      });
    } else if (line.startsWith('## ')) {
      newBlocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: line.slice(3) } }],
        },
      });
    } else if (line.startsWith('### ')) {
      newBlocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: line.slice(4) } }],
        },
      });
    } else if (line.match(/^[•\-]\s/)) {
      newBlocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
        },
      });
    } else if (line.match(/^\d+\.\s/)) {
      newBlocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{ type: 'text', text: { content: line.replace(/^\d+\.\s/, '') } }],
        },
      });
    } else {
      newBlocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: line } }],
        },
      });
    }
  }

  // Insert new blocks at the position where we deleted

  if (newBlocks.length > 0) {
    // Get all blocks that come after the insertion point (after endBlockIndex)
    const blocksToMoveToEnd = allBlocks.slice(endBlockIndex);

    // Store the content of these blocks before deleting them
    const savedBlocks: any[] = [];
    for (const block of blocksToMoveToEnd) {
      // Store the block data
      savedBlocks.push(block);
      // Delete the block
      await notion.blocks.delete({
        block_id: block.id,
      });
    }

    // Now insert the new blocks (they'll be appended at the end)
    await notion.blocks.children.append({
      block_id: pageId,
      children: newBlocks,
    });

    // Re-insert the saved blocks to maintain order
    if (savedBlocks.length > 0) {
      // We need to reconstruct the blocks in the correct format
      const blocksToReinsert: any[] = savedBlocks.map(block => {
        // Extract the block content based on type
        const blockType = block.type;
        const blockData = block[blockType];

        return {
          object: 'block',
          type: blockType,
          [blockType]: blockData
        };
      });

      // Re-insert them
      await notion.blocks.children.append({
        block_id: pageId,
        children: blocksToReinsert,
      });
    }
  }
}

/**
 * Append content to a Notion page
 */
export async function appendNotionPage(
  pageId: string,
  content: string,
  accessToken: string
): Promise<void> {
  const notion = new Client({ auth: accessToken });

  // Parse content into lines and create blocks
  const lines = content.split('\n').filter(line => line.trim());
  const blocks: any[] = [];

  for (const line of lines) {
    if (line.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
        },
      });
    } else if (line.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: line.slice(3) } }],
        },
      });
    } else if (line.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: line.slice(4) } }],
        },
      });
    } else {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: line } }],
        },
      });
    }
  }

  // Append new blocks in batches of 100 (Notion API limit)
  const NOTION_BLOCK_BATCH_LIMIT = 100;
  for (let i = 0; i < blocks.length; i += NOTION_BLOCK_BATCH_LIMIT) {
    await notion.blocks.children.append({
      block_id: pageId,
      children: blocks.slice(i, i + NOTION_BLOCK_BATCH_LIMIT),
    });
  }
}

/**
 * Delete a Notion page (archive it)
 */
export async function deleteNotionPage(
  pageId: string,
  accessToken: string
): Promise<void> {
  const notion = new Client({ auth: accessToken });

  try {
    // Archive the page (Notion doesn't have a "trash" - archiving is the delete equivalent)
    await notion.pages.update({
      page_id: pageId,
      archived: true,
    });
  } catch (error: any) {
    // Notion API doesn't allow archiving workspace-level pages
    if (error?.message?.includes('workspace level pages')) {
      throw new Error('This Notion page cannot be removed via API because it\'s at the workspace level. Please move it to a parent page first, or remove it manually in Notion.');
    }
    throw error;
  }
}

/**
 * Rename a Notion page by updating its title property
 */
export async function renameNotionPage(
  pageId: string,
  newTitle: string,
  accessToken: string
): Promise<void> {
  const notion = new Client({ auth: accessToken });

  // Update the page title
  await notion.pages.update({
    page_id: pageId,
    properties: {
      title: {
        title: [
          {
            text: {
              content: newTitle,
            },
          },
        ],
      },
    },
  });
}

/**
 * Duplicate a Notion page (creates a new page with the same content)
 */
export async function duplicateNotionPage(
  pageId: string,
  newTitle: string,
  accessToken: string
): Promise<{ pageId: string; url: string }> {
  const notion = new Client({ auth: accessToken });

  // Get the original page to get its parent
  const originalPage = await notion.pages.retrieve({ page_id: pageId });

  if (!('parent' in originalPage)) {
    throw new Error('Cannot access parent information for this page');
  }

  // Get the page content
  const blocks = await notion.blocks.children.list({
    block_id: pageId,
  });

  // Create a new page with the same parent
  // Filter out block_id parent type as it's not valid for page creation
  const parent = originalPage.parent;
  let validParent: any;

  if ('page_id' in parent) {
    validParent = { page_id: parent.page_id };
  } else if ('database_id' in parent) {
    validParent = { database_id: parent.database_id };
  } else if ('workspace' in parent) {
    validParent = { workspace: true };
  } else {
    throw new Error('Cannot duplicate page: parent type not supported');
  }

  const newPage = await notion.pages.create({
    parent: validParent,
    properties: {
      title: {
        title: [
          {
            text: {
              content: newTitle,
            },
          },
        ],
      },
    },
  });

  // Copy the blocks to the new page (simplified - only copies top-level blocks)
  if (blocks.results.length > 0) {
    // Notion API requires blocks to be added in batches
    const blockChildren = blocks.results.map((block: any) => {
      // Create a simplified copy of the block structure
      const blockCopy: any = {
        type: block.type,
      };

      // Copy the block content based on type
      if (block.type && block[block.type]) {
        blockCopy[block.type] = block[block.type];
      }

      return blockCopy;
    });

    // Add blocks to the new page
    try {
      await notion.blocks.children.append({
        block_id: newPage.id,
        children: blockChildren,
      });
    } catch (error) {
      console.error('Error copying blocks to new page:', error);
      // Continue even if blocks fail to copy - at least we have the page
    }
  }

  return {
    pageId: newPage.id,
    url: 'url' in newPage ? newPage.url : `https://www.notion.so/${newPage.id.replace(/-/g, '')}`,
  };
}

/**
 * Create a new Notion page as a subpage of another page or at workspace root
 */
export async function createNotionSubpage(
  parentPageId: string | undefined,
  pageTitle: string,
  accessToken: string,
  initialContent?: string
): Promise<{ pageId: string; url: string }> {
  const notion = new Client({ auth: accessToken });

  // Create a new page - either as a child of parent page or at workspace root
  const pageData: any = {
    properties: {
      title: {
        title: [
          {
            text: {
              content: pageTitle,
            },
          },
        ],
      },
    },
  };

  if (parentPageId) {
    pageData.parent = {
      page_id: parentPageId,
    };
  } else {
    // Create at workspace root
    pageData.parent = {
      workspace: true,
    };
  }

  const newPage = await notion.pages.create(pageData);

  // If initial content is provided, add it to the page
  if (initialContent) {
    const lines = initialContent.split('\n').filter(line => line.trim());
    const blocks: any[] = [];
    const NOTION_TEXT_LIMIT = 2000;

    const chunkText = (text: string): string[] => {
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += NOTION_TEXT_LIMIT) {
        chunks.push(text.slice(i, i + NOTION_TEXT_LIMIT));
      }
      return chunks.length > 0 ? chunks : [''];
    };

    for (const line of lines) {
      if (line.startsWith('# ')) {
        blocks.push({
          object: 'block',
          type: 'heading_1',
          heading_1: {
            rich_text: [{ type: 'text', text: { content: line.slice(2).slice(0, NOTION_TEXT_LIMIT) } }],
          },
        });
      } else if (line.startsWith('## ')) {
        blocks.push({
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [{ type: 'text', text: { content: line.slice(3).slice(0, NOTION_TEXT_LIMIT) } }],
          },
        });
      } else if (line.startsWith('### ')) {
        blocks.push({
          object: 'block',
          type: 'heading_3',
          heading_3: {
            rich_text: [{ type: 'text', text: { content: line.slice(4).slice(0, NOTION_TEXT_LIMIT) } }],
          },
        });
      } else if (line.startsWith('• ') || line.startsWith('- ')) {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: line.slice(2).slice(0, NOTION_TEXT_LIMIT) } }],
          },
        });
      } else {
        for (const chunk of chunkText(line)) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: chunk } }],
            },
          });
        }
      }
    }

    const NOTION_BLOCK_BATCH_LIMIT = 100;
    for (let i = 0; i < blocks.length; i += NOTION_BLOCK_BATCH_LIMIT) {
      await notion.blocks.children.append({
        block_id: newPage.id,
        children: blocks.slice(i, i + NOTION_BLOCK_BATCH_LIMIT),
      });
    }
  }

  return {
    pageId: newPage.id,
    url: 'url' in newPage ? newPage.url : `https://www.notion.so/${newPage.id.replace(/-/g, '')}`,
  };
}

/**
 * List child pages of a Notion page
 */
export async function listNotionPageChildren(
  pageId: string,
  accessToken: string
): Promise<Array<{ id: string; title: string; type: 'page' | 'database'; url: string }>> {
  const notion = new Client({ auth: accessToken });

  // Get all blocks in the page
  const blocks = await notion.blocks.children.list({
    block_id: pageId,
  });

  const children: Array<{ id: string; title: string; type: 'page' | 'database'; url: string }> = [];

  for (const block of blocks.results) {
    if (!('type' in block)) continue;

    if (block.type === 'child_page' && 'child_page' in block) {
      const childPage = block.child_page;
      children.push({
        id: block.id,
        title: childPage.title || 'Untitled',
        type: 'page',
        url: `https://www.notion.so/${block.id.replace(/-/g, '')}`,
      });
    } else if (block.type === 'child_database' && 'child_database' in block) {
      const childDb = block.child_database;
      children.push({
        id: block.id,
        title: (childDb as any).title || 'Untitled Database',
        type: 'database',
        url: `https://www.notion.so/${block.id.replace(/-/g, '')}`,
      });
    }
  }

  return children;
}

/**
 * Get database title/name and schema
 */
export async function getNotionDatabase(
  databaseId: string,
  accessToken: string
): Promise<{ title: string; properties: any }> {
  const notion = new Client({ auth: accessToken });

  const database = await notion.databases.retrieve({ database_id: databaseId }) as any;

  // Extract database title
  let title = 'Untitled Database';
  if (database.title && database.title.length > 0) {
    title = database.title[0].plain_text || 'Untitled Database';
  }

  return {
    title,
    properties: database.properties || {},
  };
}

/**
 * Create a new page in a Notion database
 * @param databaseId - The ID of the database to add the page to
 * @param properties - Object containing property values (e.g., { "Name": "My Page", "Status": "In Progress" })
 * @param content - Optional markdown content to add to the page body
 * @param accessToken - Notion access token
 */
export async function createNotionDatabasePage(
  databaseId: string,
  properties: Record<string, any>,
  accessToken: string,
  content?: string
): Promise<{ pageId: string; url: string }> {
  const notion = new Client({ auth: accessToken });

  // Get database to find data sources
  const database = await notion.databases.retrieve({ database_id: databaseId }) as any;

  // Check if database has data sources (new API structure)
  let dbProperties: any;

  if (database.data_sources && database.data_sources.length > 0) {
    // New API structure: fetch the first data source to get properties
    const dataSourceId = database.data_sources[0].id;
    console.log(`Fetching data source properties for data source ID: ${dataSourceId}`);

    try {
      // Fetch data source details to get properties
      const dataSource = await (notion as any).dataSources.retrieve({ data_source_id: dataSourceId });
      dbProperties = dataSource.properties;
    } catch (error) {
      console.error('Error fetching data source:', error);
      throw new Error(`Failed to fetch data source properties: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  } else if (database.properties) {
    // Old API structure: properties directly on database
    dbProperties = database.properties;
  }

  if (!dbProperties || Object.keys(dbProperties).length === 0) {
    console.error('Database retrieval result:', JSON.stringify(database, null, 2));
    throw new Error(`Database has no properties defined. Database ID: ${databaseId}`);
  }

  // Convert properties to proper Notion format based on schema
  const formattedProperties: any = {};

  for (const [propName, propValue] of Object.entries(properties)) {
    const propSchema = dbProperties[propName];
    if (!propSchema) {
      console.warn(`Property "${propName}" not found in database schema, skipping`);
      continue;
    }

    const propType = propSchema.type;

    // Format based on property type
    switch (propType) {
      case 'title':
        formattedProperties[propName] = {
          title: [{ text: { content: String(propValue) } }],
        };
        break;
      case 'rich_text':
        formattedProperties[propName] = {
          rich_text: [{ text: { content: String(propValue) } }],
        };
        break;
      case 'number':
        formattedProperties[propName] = {
          number: Number(propValue),
        };
        break;
      case 'select':
        formattedProperties[propName] = {
          select: { name: String(propValue) },
        };
        break;
      case 'multi_select':
        const values = Array.isArray(propValue) ? propValue : [propValue];
        formattedProperties[propName] = {
          multi_select: values.map((v: any) => ({ name: String(v) })),
        };
        break;
      case 'date':
        formattedProperties[propName] = {
          date: { start: String(propValue) },
        };
        break;
      case 'checkbox':
        formattedProperties[propName] = {
          checkbox: Boolean(propValue),
        };
        break;
      case 'url':
        formattedProperties[propName] = {
          url: String(propValue),
        };
        break;
      case 'email':
        formattedProperties[propName] = {
          email: String(propValue),
        };
        break;
      case 'phone_number':
        formattedProperties[propName] = {
          phone_number: String(propValue),
        };
        break;
      default:
        console.warn(`Property type "${propType}" not supported for property "${propName}", skipping`);
    }
  }

  // Check if at least one property was formatted
  if (Object.keys(formattedProperties).length === 0) {
    const availableProps = Object.keys(dbProperties).join(', ');
    const requestedProps = Object.keys(properties).join(', ');
    throw new Error(
      `No valid properties found. Requested properties: ${requestedProps}. Available properties in database: ${availableProps}`
    );
  }

  // Create the page
  const newPage = await notion.pages.create({
    parent: { database_id: databaseId },
    properties: formattedProperties,
  });

  // If content is provided, add it to the page
  if (content) {
    const lines = content.split('\n').filter(line => line.trim());
    const blocks: any[] = [];

    for (const line of lines) {
      if (line.startsWith('# ')) {
        blocks.push({
          object: 'block',
          type: 'heading_1',
          heading_1: {
            rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
          },
        });
      } else if (line.startsWith('## ')) {
        blocks.push({
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [{ type: 'text', text: { content: line.slice(3) } }],
          },
        });
      } else if (line.startsWith('### ')) {
        blocks.push({
          object: 'block',
          type: 'heading_3',
          heading_3: {
            rich_text: [{ type: 'text', text: { content: line.slice(4) } }],
          },
        });
      } else if (line.startsWith('• ') || line.startsWith('- ')) {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
          },
        });
      } else {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: line } }],
          },
        });
      }
    }

    const NOTION_BLOCK_BATCH_LIMIT = 100;
    for (let i = 0; i < blocks.length; i += NOTION_BLOCK_BATCH_LIMIT) {
      await notion.blocks.children.append({
        block_id: newPage.id,
        children: blocks.slice(i, i + NOTION_BLOCK_BATCH_LIMIT),
      });
    }
  }

  return {
    pageId: newPage.id,
    url: 'url' in newPage ? newPage.url : `https://www.notion.so/${newPage.id.replace(/-/g, '')}`,
  };
}

/**
 * Query database pages (with optional filters)
 */
export async function queryNotionDatabase(
  databaseId: string,
  accessToken: string,
  filter?: any,
  sorts?: any[]
): Promise<any[]> {
  const notion = new Client({ auth: accessToken });

  // Type assertion to work around TypeScript definition limitations
  const response = await (notion.databases as any).query({
    database_id: databaseId,
    filter,
    sorts,
  });

  return response.results;
}

/**
 * Create a new Notion database
 * @param parentPageId - The ID of the parent page to create the database in
 * @param title - The title of the database
 * @param properties - Database property schema (e.g., { "Name": { title: {} }, "Status": { select: { options: [...] } } })
 * @param accessToken - Notion access token
 */
export async function createNotionDatabase(
  parentPageId: string | undefined,
  title: string,
  properties: Record<string, any>,
  accessToken: string
): Promise<{ databaseId: string; url: string }> {
  const notion = new Client({ auth: accessToken });

  // Determine parent: either a page or workspace level
  const parent = parentPageId
    ? {
      type: 'page_id' as const,
      page_id: parentPageId,
    }
    : {
      type: 'workspace' as const,
      workspace: true,
    };

  const database = await notion.databases.create({
    parent: parent,
    title: [
      {
        type: 'text',
        text: {
          content: title,
        },
      },
    ],
    properties: properties,
  } as any);

  return {
    databaseId: database.id,
    url: 'url' in database ? database.url : `https://www.notion.so/${database.id.replace(/-/g, '')}`,
  };
}

/**
 * Read database schema and properties
 */
export async function readNotionDatabase(
  databaseId: string,
  accessToken: string
): Promise<{ title: string; properties: Record<string, any>; url: string }> {
  const notion = new Client({ auth: accessToken });

  const database = await notion.databases.retrieve({ database_id: databaseId }) as any;

  let title = 'Untitled Database';
  if (database.title && database.title.length > 0) {
    title = database.title[0].plain_text || 'Untitled Database';
  }

  // Check if database has data sources (new API structure)
  let dbProperties: any = {};

  if (database.data_sources && database.data_sources.length > 0) {
    // New API structure: fetch the first data source to get properties
    const dataSourceId = database.data_sources[0].id;

    try {
      // Fetch data source details to get properties
      const dataSource = await (notion as any).dataSources.retrieve({ data_source_id: dataSourceId });
      dbProperties = dataSource.properties || {};
    } catch (error) {
      console.error('Error fetching data source:', error);
      // Fallback to empty properties
    }
  } else if (database.properties) {
    // Old API structure: properties directly on database
    dbProperties = database.properties;
  }

  return {
    title,
    properties: dbProperties,
    url: database.url || `https://www.notion.so/${databaseId.replace(/-/g, '')}`,
  };
}

/**
 * Update database title and/or properties
 */
export async function updateNotionDatabase(
  databaseId: string,
  accessToken: string,
  title?: string,
  properties?: Record<string, any>
): Promise<void> {
  const notion = new Client({ auth: accessToken });

  // Step 1: Update database title if provided
  if (title) {
    await notion.databases.update({
      database_id: databaseId,
      title: [
        {
          type: 'text',
          text: {
            content: title,
          },
        },
      ],
    } as any);
  }

  // Step 2: Update properties via data source API if provided
  if (properties && Object.keys(properties).length > 0) {

    // Get the database to find its data sources
    const database = await notion.databases.retrieve({ database_id: databaseId }) as any;

    if (database.data_sources && database.data_sources.length > 0) {
      const dataSourceId = database.data_sources[0].id;

      // Use data source update API (required for API version 2025-09-03)
      await (notion as any).dataSources.update({
        data_source_id: dataSourceId,
        properties: properties,
      });

    } else {
      // Fallback to old API if no data sources
      await notion.databases.update({
        database_id: databaseId,
        properties: properties,
      } as any);
    }
  }

}

/**
 * Archive/delete a Notion database
 */
export async function deleteNotionDatabase(
  databaseId: string,
  accessToken: string
): Promise<void> {
  const notion = new Client({ auth: accessToken });


  try {
    const result = await notion.databases.update({
      database_id: databaseId,
      in_trash: true,  // Databases use in_trash instead of archived
    } as any);

    console.log('[deleteNotionDatabase] Database moved to trash successfully:', {
      id: result.id,
      in_trash: (result as any).in_trash
    });
  } catch (error: any) {

    // Check if this is the workspace-level database limitation
    if (error.message && error.message.includes('workspace level')) {
      throw new Error('Cannot archive workspace-level databases via API. Only databases inside pages can be archived. Please archive this database manually in Notion or move it inside a page first.');
    }

    throw new Error(`Failed to move database to trash: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Duplicate a Notion database (copies schema but not data/rows)
 */
export async function duplicateNotionDatabase(
  databaseId: string,
  accessToken: string,
  newDatabaseName?: string
): Promise<{ databaseId: string; title: string; url: string }> {
  const notion = new Client({ auth: accessToken });

  // Get the original database
  const originalDatabase = await notion.databases.retrieve({ database_id: databaseId }) as any;

  // Get the original database title
  let originalTitle = 'Untitled';
  if (originalDatabase.title && Array.isArray(originalDatabase.title) && originalDatabase.title.length > 0) {
    originalTitle = originalDatabase.title[0].plain_text || 'Untitled';
  }

  // Determine new title
  const newTitle = newDatabaseName || `${originalTitle} (Copy)`;

  // Get properties from data source or direct properties
  let rawProperties: any = {};
  if (originalDatabase.data_sources && originalDatabase.data_sources.length > 0) {
    // New API structure: fetch the first data source
    const dataSourceId = originalDatabase.data_sources[0].id;
    const dataSource = await (notion as any).dataSources.retrieve({ data_source_id: dataSourceId });
    rawProperties = dataSource.properties;
  } else if (originalDatabase.properties) {
    // Old API structure
    rawProperties = originalDatabase.properties;
  }

  console.log('[duplicateDatabase] Raw properties retrieved:', JSON.stringify(rawProperties, null, 2));

  // Clean properties by removing metadata fields (id, name, etc.) that the create API doesn't accept
  // Keep only the type-specific configuration
  const properties: any = {};
  for (const [propName, propSchema] of Object.entries(rawProperties)) {
    const schema = propSchema as any;
    const propType = schema.type;

    // Create a clean property definition with just the type configuration
    if (propType === 'title') {
      properties[propName] = { title: {} };
    } else if (propType === 'rich_text') {
      properties[propName] = { rich_text: {} };
    } else if (propType === 'number') {
      properties[propName] = { number: schema.number || {} };
    } else if (propType === 'select') {
      properties[propName] = { select: schema.select || {} };
    } else if (propType === 'multi_select') {
      properties[propName] = { multi_select: schema.multi_select || {} };
    } else if (propType === 'date') {
      properties[propName] = { date: {} };
    } else if (propType === 'checkbox') {
      properties[propName] = { checkbox: {} };
    } else if (propType === 'url') {
      properties[propName] = { url: {} };
    } else if (propType === 'email') {
      properties[propName] = { email: {} };
    } else if (propType === 'phone_number') {
      properties[propName] = { phone_number: {} };
    } else if (propType === 'people') {
      properties[propName] = { people: {} };
    } else if (propType === 'files') {
      properties[propName] = { files: {} };
    } else if (propType === 'relation') {
      properties[propName] = { relation: schema.relation || {} };
    } else if (propType === 'rollup') {
      properties[propName] = { rollup: schema.rollup || {} };
    } else if (propType === 'formula') {
      properties[propName] = { formula: schema.formula || {} };
    } else if (propType === 'status') {
      properties[propName] = { status: schema.status || {} };
    } else if (propType === 'created_time') {
      properties[propName] = { created_time: {} };
    } else if (propType === 'created_by') {
      properties[propName] = { created_by: {} };
    } else if (propType === 'last_edited_time') {
      properties[propName] = { last_edited_time: {} };
    } else if (propType === 'last_edited_by') {
      properties[propName] = { last_edited_by: {} };
    } else {
      console.warn(`[duplicateDatabase] Unknown property type "${propType}" for property "${propName}", copying as-is`);
      properties[propName] = { [propType]: schema[propType] || {} };
    }
  }

  console.log('[duplicateDatabase] Cleaned properties for create:', JSON.stringify(properties, null, 2));

  // Get parent info
  const parent = originalDatabase.parent;

  console.log('[duplicateDatabase] Creating database with parent:', JSON.stringify(parent, null, 2));
  console.log('[duplicateDatabase] Number of properties:', Object.keys(properties).length);

  // Two-step process: Create database with minimal properties, then update to add remaining ones
  // Notion's create API only accepts the title property during creation
  try {
    // Step 1: Find the title property (required for database creation)
    const titleProperty = Object.entries(properties).find(([_, schema]: [string, any]) => schema.title);
    const titlePropName = titleProperty ? titleProperty[0] : "Name";
    const minimalProperties = titleProperty
      ? { [titlePropName]: titleProperty[1] }
      : { "Name": { "title": {} } }; // Fallback

    console.log('[duplicateDatabase] Step 1: Creating with title property only');

    const newDatabase = await notion.databases.create({
      parent: parent,
      title: [{ type: 'text', text: { content: newTitle } }],
      properties: minimalProperties,
    } as any);

    console.log('[duplicateDatabase] Database created:', newDatabase.id);

    // Step 2: Add remaining properties via data source update (new API requirement)
    const remainingProperties = Object.fromEntries(
      Object.entries(properties).filter(([name, _]) => name !== titlePropName)
    );

    if (Object.keys(remainingProperties).length > 0) {
      console.log('[duplicateDatabase] Step 2: Adding', Object.keys(remainingProperties).length, 'remaining properties');

      // Get the data source ID from the newly created database
      const createdDb = await notion.databases.retrieve({ database_id: newDatabase.id }) as any;

      if (createdDb.data_sources && createdDb.data_sources.length > 0) {
        const dataSourceId = createdDb.data_sources[0].id;
        console.log('[duplicateDatabase] Using data source API to add properties to data source:', dataSourceId);

        // Use data source update API (required for API version 2025-09-03)
        await (notion as any).dataSources.update({
          data_source_id: dataSourceId,
          properties: remainingProperties,
        });

        console.log('[duplicateDatabase] All properties added successfully via data source API');
      } else {
        // Fallback to old API if no data sources
        console.log('[duplicateDatabase] No data sources found, using legacy database update API');
        await notion.databases.update({
          database_id: newDatabase.id,
          properties: remainingProperties,
        } as any);
      }
    }

    // Verify final property count
    const verifyDatabase = await notion.databases.retrieve({ database_id: newDatabase.id }) as any;
    let finalPropertyCount = 0;

    if (verifyDatabase.data_sources && verifyDatabase.data_sources.length > 0) {
      const dataSourceId = verifyDatabase.data_sources[0].id;
      const verifyDataSource = await (notion as any).dataSources.retrieve({ data_source_id: dataSourceId });
      finalPropertyCount = Object.keys(verifyDataSource.properties || {}).length;
      console.log('[duplicateDatabase] Final verification - properties:', finalPropertyCount, '/', Object.keys(properties).length);
    } else if (verifyDatabase.properties) {
      finalPropertyCount = Object.keys(verifyDatabase.properties).length;
      console.log('[duplicateDatabase] Final verification - properties:', finalPropertyCount, '/', Object.keys(properties).length);
    }

    return {
      databaseId: newDatabase.id,
      title: newTitle,
      url: 'url' in newDatabase ? newDatabase.url : `https://www.notion.so/${newDatabase.id.replace(/-/g, '')}`
    };
  } catch (error) {
    console.error('[duplicateDatabase] Error:', error);
    throw error;
  }
}

/**
 * Update properties and/or content of a database page
 * @param pageId - The ID of the page to update
 * @param properties - Optional object containing property values to update
 * @param content - Optional markdown content to replace the page body
 * @param accessToken - Notion access token
 */
export async function updateNotionDatabasePage(
  pageId: string,
  accessToken: string,
  properties?: Record<string, any>,
  content?: string
): Promise<void> {
  const notion = new Client({ auth: accessToken });

  // Update properties if provided
  if (properties && Object.keys(properties).length > 0) {
    // Get the page to find its database
    const page = await notion.pages.retrieve({ page_id: pageId }) as any;

    if (!('parent' in page) || !('database_id' in page.parent)) {
      throw new Error('This page is not a database page');
    }

    const databaseId = page.parent.database_id;

    // Get database to find data sources
    const database = await notion.databases.retrieve({ database_id: databaseId }) as any;

    // Check if database has data sources (new API structure)
    let dbProperties: any;

    if (database.data_sources && database.data_sources.length > 0) {
      // New API structure: fetch the first data source to get properties
      const dataSourceId = database.data_sources[0].id;
      console.log(`Fetching data source properties for data source ID: ${dataSourceId}`);

      try {
        // Fetch data source details to get properties
        const dataSource = await (notion as any).dataSources.retrieve({ data_source_id: dataSourceId });
        dbProperties = dataSource.properties;
      } catch (error) {
        console.error('Error fetching data source:', error);
        throw new Error(`Failed to fetch data source properties: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else if (database.properties) {
      // Old API structure: properties directly on database
      dbProperties = database.properties;
    }

    if (!dbProperties || Object.keys(dbProperties).length === 0) {
      throw new Error('Database has no properties defined');
    }

    // Convert properties to proper Notion format based on schema
    const formattedProperties: any = {};

    for (const [propName, propValue] of Object.entries(properties)) {
      const propSchema = dbProperties[propName];
      if (!propSchema) {
        console.warn(`Property "${propName}" not found in database schema, skipping`);
        continue;
      }

      const propType = propSchema.type;

      // Format based on property type
      switch (propType) {
        case 'title':
          formattedProperties[propName] = {
            title: [{ text: { content: String(propValue) } }],
          };
          break;
        case 'rich_text':
          formattedProperties[propName] = {
            rich_text: [{ text: { content: String(propValue) } }],
          };
          break;
        case 'number':
          formattedProperties[propName] = {
            number: Number(propValue),
          };
          break;
        case 'select':
          formattedProperties[propName] = {
            select: propValue === null ? null : { name: String(propValue) },
          };
          break;
        case 'multi_select':
          const values = Array.isArray(propValue) ? propValue : [propValue];
          formattedProperties[propName] = {
            multi_select: values.map((v: any) => ({ name: String(v) })),
          };
          break;
        case 'date':
          formattedProperties[propName] = {
            date: propValue === null ? null : { start: String(propValue) },
          };
          break;
        case 'checkbox':
          formattedProperties[propName] = {
            checkbox: Boolean(propValue),
          };
          break;
        case 'url':
          formattedProperties[propName] = {
            url: propValue === null ? null : String(propValue),
          };
          break;
        case 'email':
          formattedProperties[propName] = {
            email: propValue === null ? null : String(propValue),
          };
          break;
        case 'phone_number':
          formattedProperties[propName] = {
            phone_number: propValue === null ? null : String(propValue),
          };
          break;
        default:
          console.warn(`Property type "${propType}" not supported for property "${propName}", skipping`);
      }
    }

    // Check if at least one property was formatted
    if (Object.keys(formattedProperties).length === 0) {
      const availableProps = Object.keys(dbProperties).join(', ');
      const requestedProps = Object.keys(properties).join(', ');
      throw new Error(
        `No valid properties found to update. Requested properties: ${requestedProps}. Available properties in database: ${availableProps}`
      );
    }

    // Update the page properties
    await notion.pages.update({
      page_id: pageId,
      properties: formattedProperties,
    });
  }

  // Update content if provided
  if (content !== undefined) {
    // Delete all existing blocks
    const existingBlocks = await notion.blocks.children.list({
      block_id: pageId,
    });

    for (const block of existingBlocks.results) {
      if ('id' in block) {
        await notion.blocks.delete({
          block_id: block.id,
        });
      }
    }

    // Parse content into lines and create new blocks
    const lines = content.split('\n').filter(line => line.trim());
    const blocks: any[] = [];

    for (const line of lines) {
      if (line.startsWith('# ')) {
        blocks.push({
          object: 'block',
          type: 'heading_1',
          heading_1: {
            rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
          },
        });
      } else if (line.startsWith('## ')) {
        blocks.push({
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [{ type: 'text', text: { content: line.slice(3) } }],
          },
        });
      } else if (line.startsWith('### ')) {
        blocks.push({
          object: 'block',
          type: 'heading_3',
          heading_3: {
            rich_text: [{ type: 'text', text: { content: line.slice(4) } }],
          },
        });
      } else if (line.startsWith('• ') || line.startsWith('- ')) {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
          },
        });
      } else {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: line } }],
          },
        });
      }
    }

    // Append new blocks in batches of 100 (Notion API limit)
    const NOTION_BLOCK_BATCH_LIMIT = 100;
    for (let i = 0; i < blocks.length; i += NOTION_BLOCK_BATCH_LIMIT) {
      await notion.blocks.children.append({
        block_id: pageId,
        children: blocks.slice(i, i + NOTION_BLOCK_BATCH_LIMIT),
      });
    }
  }
}
