import { google } from 'googleapis';
import type { DAFStorageAdapter } from '../types';

// Google OAuth 2.0 configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/integrations/google/callback';

// Google OAuth 2.0 Scopes
// Using drive.file scope to access only files created by or opened with this app
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file', // Per-file access to Google Drive
];

/**
 * Get OAuth2 client for Google
 */
export function getGoogleOAuth2Client() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

/**
 * Generate Google OAuth authorization URL
 */
export function getGoogleAuthUrl(userId: string): string {
  const oauth2Client = getGoogleOAuth2Client();

  return oauth2Client.generateAuthUrl({
    access_type: 'offline', // Request refresh token
    scope: GOOGLE_SCOPES,
    state: userId, // Pass userId to retrieve after callback
    prompt: 'consent', // Force consent screen to get refresh token
  });
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeGoogleCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}> {
  const oauth2Client = getGoogleOAuth2Client();

  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.access_token) {
    throw new Error('No access token received from Google');
  }

  const expiresAt = new Date();
  if (tokens.expiry_date) {
    expiresAt.setTime(tokens.expiry_date);
  } else {
    expiresAt.setHours(expiresAt.getHours() + 1); // Default 1 hour
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || null,
    expiresAt,
  };
}

/**
 * Refresh Google access token using refresh token
 */
export async function refreshGoogleToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt: Date;
}> {
  const oauth2Client = getGoogleOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await oauth2Client.refreshAccessToken();

  if (!credentials.access_token) {
    throw new Error('Failed to refresh Google access token');
  }

  const expiresAt = new Date();
  if (credentials.expiry_date) {
    expiresAt.setTime(credentials.expiry_date);
  } else {
    expiresAt.setHours(expiresAt.getHours() + 1);
  }

  return {
    accessToken: credentials.access_token,
    expiresAt,
  };
}

/**
 * Get or refresh Google access token for a user
 */
export async function getGoogleAccessToken(
  userId: string,
  adapter: DAFStorageAdapter
): Promise<string> {
  const integration = await adapter.getGoogleIntegration(userId);

  if (!integration) {
    throw new Error('Google integration not found. Please connect your Google account.');
  }

  // Check if token is expired or about to expire (within 5 minutes)
  const now = new Date();
  const expiresAt = integration.expiresAt ? new Date(integration.expiresAt) : now;
  const isExpired = expiresAt.getTime() - now.getTime() < 5 * 60 * 1000;

  if (isExpired && integration.refreshToken) {
    const { accessToken, expiresAt: newExpiresAt } = await refreshGoogleToken(
      integration.refreshToken
    );

    await adapter.updateGoogleIntegration(integration.id, { accessToken, expiresAt: newExpiresAt });

    return accessToken;
  }

  return integration.accessToken;
}

/**
 * Extract document ID from Google Docs URL
 */
export function extractDocIdFromUrl(url: string): string | null {
  const patterns = [
    /docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/,
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9-_]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Read content from a Google Doc using Drive API
 */
export async function readGoogleDoc(
  documentId: string,
  accessToken: string
): Promise<{ title: string; content: string }> {
  const oauth2Client = getGoogleOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  // First, verify we have access to this file via Drive API
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  try {
    // Check if file exists and we have access
    const fileMetadata = await drive.files.get({
      fileId: documentId,
      fields: 'id,name,mimeType',
    });

    // Verify it's a Google Doc
    if (fileMetadata.data.mimeType !== 'application/vnd.google-apps.document') {
      throw new Error('File is not a Google Doc');
    }

    const title = fileMetadata.data.name || '';

    // Now read the document content using Docs API
    const docs = google.docs({ version: 'v1', auth: oauth2Client });
    const response = await docs.documents.get({
      documentId,
    });

    // Extract text content from the document
    const content = response.data.body?.content || [];
    let text = '';

    for (const element of content) {
      if (element.paragraph) {
        const paragraph = element.paragraph;
        if (paragraph.elements) {
          for (const el of paragraph.elements) {
            if (el.textRun && el.textRun.content) {
              text += el.textRun.content;
            }
          }
        }
      }
    }

    return { title, content: text };
  } catch (error: any) {
    if (error.code === 404) {
      throw new Error('Document not found or access denied. Please re-select the file using Google Picker.');
    }
    throw error;
  }
}

/**
 * Replace entire content of a Google Doc
 * Uses Drive API to verify access before writing
 */
export async function writeGoogleDoc(
  documentId: string,
  content: string,
  accessToken: string
): Promise<void> {
  const oauth2Client = getGoogleOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  // Verify access via Drive API
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  try {
    const fileMetadata = await drive.files.get({
      fileId: documentId,
      fields: 'id,name,mimeType',
    });

    if (fileMetadata.data.mimeType !== 'application/vnd.google-apps.document') {
      throw new Error('File is not a Google Doc');
    }

    // Proceed with Docs API
    const docs = google.docs({ version: 'v1', auth: oauth2Client });

    // Get the document to find the end index
    const doc = await docs.documents.get({ documentId });
    const endIndex = doc.data.body?.content?.[doc.data.body.content.length - 1]?.endIndex || 1;

    // Build requests array
    const requests: any[] = [];

    // Only delete content if the document is not empty
    if (endIndex > 2) {
      requests.push({
        deleteContentRange: {
          range: {
            startIndex: 1,
            endIndex: endIndex - 1,
          },
        },
      });
    }

    // Insert new content
    requests.push({
      insertText: {
        location: {
          index: 1,
        },
        text: content,
      },
    });

    // Delete all content and insert new content
    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests,
      },
    });
  } catch (error: any) {
    if (error.code === 404) {
      throw new Error('Document not found or access denied. Please re-select the file using Google Picker.');
    }
    throw error;
  }
}

/**
 * Selectively replace content in a Google Doc at a specific range
 */
export async function selectiveUpdateGoogleDoc(
  documentId: string,
  content: string,
  startIndex: number,
  endIndex: number,
  accessToken: string
): Promise<void> {
  const oauth2Client = getGoogleOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const docs = google.docs({ version: 'v1', auth: oauth2Client });

  // Build requests: delete range then insert new content
  const requests: any[] = [];

  // Delete the specified range
  if (endIndex > startIndex) {
    requests.push({
      deleteContentRange: {
        range: {
          startIndex,
          endIndex,
        },
      },
    });
  }

  // Insert new content at the start position
  requests.push({
    insertText: {
      location: {
        index: startIndex,
      },
      text: content,
    },
  });

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests,
    },
  });
}

/**
 * Append content to a Google Doc
 */
export async function appendGoogleDoc(
  documentId: string,
  content: string,
  accessToken: string
): Promise<void> {
  const oauth2Client = getGoogleOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const docs = google.docs({ version: 'v1', auth: oauth2Client });

  // Get the document to find the end index
  const doc = await docs.documents.get({ documentId });
  const endIndex = doc.data.body?.content?.[doc.data.body.content.length - 1]?.endIndex || 1;

  // Insert content at the end
  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: {
              index: endIndex - 1,
            },
            text: content,
          },
        },
      ],
    },
  });
}

/**
 * Format text in a Google Doc (apply bold, italic, etc.)
 */
export async function formatGoogleDoc(
  documentId: string,
  startIndex: number,
  endIndex: number,
  formatting: {
    bold?: boolean;
    italic?: boolean;
    fontSize?: number;
  },
  accessToken: string
): Promise<void> {
  const oauth2Client = getGoogleOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const docs = google.docs({ version: 'v1', auth: oauth2Client });

  const textStyle: any = {};
  if (formatting.bold !== undefined) textStyle.bold = formatting.bold;
  if (formatting.italic !== undefined) textStyle.italic = formatting.italic;
  if (formatting.fontSize !== undefined) {
    textStyle.fontSize = {
      magnitude: formatting.fontSize,
      unit: 'PT',
    };
  }

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        {
          updateTextStyle: {
            range: {
              startIndex,
              endIndex,
            },
            textStyle,
            fields: Object.keys(textStyle).join(','),
          },
        },
      ],
    },
  });
}

/**
 * Delete a Google Doc (move to trash)
 */
export async function deleteGoogleDoc(
  documentId: string,
  accessToken: string
): Promise<void> {
  const oauth2Client = getGoogleOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  // Move file to trash (recoverable)
  await drive.files.update({
    fileId: documentId,
    requestBody: {
      trashed: true,
    },
  });
}

/**
 * Rename a Google Doc
 */
export async function renameGoogleDoc(
  documentId: string,
  newName: string,
  accessToken: string
): Promise<void> {
  const oauth2Client = getGoogleOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  // Update the file name
  await drive.files.update({
    fileId: documentId,
    requestBody: {
      name: newName,
    },
  });
}

/**
 * Duplicate a Google Doc
 */
export async function duplicateGoogleDoc(
  documentId: string,
  newName: string,
  accessToken: string
): Promise<{ documentId: string; url: string }> {
  const oauth2Client = getGoogleOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  // Copy the file
  const response = await drive.files.copy({
    fileId: documentId,
    requestBody: {
      name: newName,
    },
    fields: 'id, webViewLink',
  });

  return {
    documentId: response.data.id!,
    url: response.data.webViewLink!,
  };
}

/**
 * Create a Google Drive folder
 */
export async function createGoogleDriveFolder(
  folderName: string,
  accessToken: string,
  parentFolderId?: string
): Promise<{ folderId: string; url: string }> {
  const oauth2Client = getGoogleOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  const requestBody: any = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };

  // If parent folder ID is provided, add it to the request
  if (parentFolderId) {
    requestBody.parents = [parentFolderId];
  }

  // Create the folder
  const response = await drive.files.create({
    requestBody,
    fields: 'id, webViewLink',
  });

  return {
    folderId: response.data.id!,
    url: response.data.webViewLink!,
  };
}

/**
 * Extract folder ID from Google Drive folder URL
 */
export function extractFolderIdFromUrl(url: string): string | null {
  // Handle root folder (My Drive) special case
  if (url === 'https://drive.google.com/drive/my-drive') {
    return 'root';
  }

  // Google Drive folder URLs are in format:
  // https://drive.google.com/drive/folders/FOLDER_ID
  // https://drive.google.com/drive/u/0/folders/FOLDER_ID
  const match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * Delete a Google Drive folder (move to trash)
 */
export async function deleteGoogleDriveFolder(
  folderId: string,
  accessToken: string
): Promise<void> {
  const oauth2Client = getGoogleOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  // Move folder to trash (recoverable)
  await drive.files.update({
    fileId: folderId,
    requestBody: {
      trashed: true,
    },
  });
}

/**
 * Rename a Google Drive folder
 */
export async function renameGoogleDriveFolder(
  folderId: string,
  newName: string,
  accessToken: string
): Promise<void> {
  const oauth2Client = getGoogleOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  // Update the folder name
  await drive.files.update({
    fileId: folderId,
    requestBody: {
      name: newName,
    },
  });
}

/**
 * Create a new Google Doc in a specific folder or root
 */
export async function createGoogleDocInFolder(
  documentName: string,
  accessToken: string,
  parentFolderId?: string,
  initialContent?: string
): Promise<{ documentId: string; url: string }> {
  const oauth2Client = getGoogleOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  // Create a new Google Doc
  const fileMetadata: any = {
    name: documentName,
    mimeType: 'application/vnd.google-apps.document',
  };

  // Only add parents if a parent folder is specified (otherwise creates in root)
  if (parentFolderId) {
    fileMetadata.parents = [parentFolderId];
  }

  const file = await drive.files.create({
    requestBody: fileMetadata,
    fields: 'id, webViewLink',
  });

  const documentId = file.data.id!;
  const url = file.data.webViewLink!;

  // If initial content is provided, write it to the document
  if (initialContent) {
    const docs = google.docs({ version: 'v1', auth: oauth2Client });
    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: {
                index: 1,
              },
              text: initialContent,
            },
          },
        ],
      },
    });
  }

  return {
    documentId,
    url,
  };
}

/**
 * List files and folders in a Google Drive folder
 */
export async function listGoogleDriveFolderContents(
  folderId: string,
  accessToken: string
): Promise<Array<{ id: string; name: string; type: 'file' | 'folder'; mimeType: string; url: string }>> {
  const oauth2Client = getGoogleOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  // List files in the folder
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, mimeType, webViewLink)',
    orderBy: 'folder,name', // Folders first, then sort by name
  });

  const files = response.data.files || [];

  return files.map(file => ({
    id: file.id!,
    name: file.name!,
    type: file.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
    mimeType: file.mimeType!,
    url: file.webViewLink!,
  }));
}
