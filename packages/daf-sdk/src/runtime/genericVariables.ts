/**
 * Generic Variables - System-defined variables that help users reference actions
 * These are read-only and available to all users
 */

export interface GenericVariable {
  name: string;
  value: string;
  description: string;
}

export const GENERIC_VARIABLES: Record<string, string> = {
  DESC_SEND_EMAIL: `**Send Email**

**JSON Format:**
"{
  "type": "action",
  "variant": "sendEmail",
  "parameters": {
    "to": "recipient@example.com",
    "subject": "Subject line",
    "content": "Email content to send"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Sends custom content to any email address using the user's generic email address.

**Parameters:**
- \`to\` (string, required): The recipient email address
- \`subject\` (string, required): The email subject line
- \`content\` (string, required): The email content to send`,

  DESC_SCRAPE: `**Scrape Webpage**

**JSON Format:**
"{
  "type": "action",
  "variant": "scrape",
  "parameters": {
    "url": "https://example.com",
    "timeout": 30000
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Scrapes web content from a single webpage and returns it in markdown format with main content only.

**Parameters:**
- \`url\` (string, required): The URL to scrape
- \`timeout\` (number, optional): Request timeout in milliseconds (default: 30000)

**Note:** Format is automatically set to markdown, only main content is extracted (navigation/ads removed), maxAge is always 0 for fresh content, and content is truncated after approximately 10k tokens (~7,500 words or 15 pages) to optimize performance.`,

  DESC_SEARCH: `**Web Search**

**JSON Format:**
"{
  "type": "action",
  "variant": "search",
  "parameters": {
    "query": "search query",
    "limit": 5
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Searches the web and automatically scrapes the content from search results.

**Parameters:**
- \`query\` (string, required): The search query
- \`limit\` (number, optional): Maximum number of results (default: 5)

**Note:** Source is always "web", content is automatically scraped with default timeout and settings, and each result is truncated after approximately 10k tokens (~7,500 words or 15 pages) to optimize performance.`,

  DESC_NEWS_SEARCH: `**News Search**

**JSON Format:**
"{
  "type": "action",
  "variant": "newsSearch",
  "parameters": {
    "query": "search query",
    "limit": 5
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Searches news sources and automatically scrapes the content from news results.

**Parameters:**
- \`query\` (string, required): The news search query
- \`limit\` (number, optional): Maximum number of results (default: 5)`,

  DESC_QUICK_SEARCH: `**Preview Web Search**

**JSON Format:**
"{
  "type": "action",
  "variant": "previewSearch",
  "parameters": {
    "query": "search query",
    "limit": 10
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Fast web search that returns title, URL, and a short snippet for each result - no full page scraping. Much faster than Web Search (~1-2 seconds), ideal when you need to find sources or check what's out there without reading full pages.

**Parameters:**
- \`query\` (string, required): The search query
- \`limit\` (number, optional): Maximum number of results (default: 10)
- \`sources\` (array, optional): Result types to include - \`["web"]\` or \`["news"]\` (default: \`["web"]\`)

**Note:** Returns snippets only - no full page content. Use the \`scrape\` action on specific URLs if you need the full content of a page.`,

  DESC_TAVILY_SEARCH: `**Tavily Search**

**JSON Format:**
"{
  "type": "action",
  "variant": "tavilySearch",
  "parameters": {
    "query": "search query",
    "maxResults": 10,
    "searchDepth": "basic"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Web search powered by Tavily's AI search API. Returns pre-extracted clean content for each result without live page scraping. Typically faster than Web Search. Requires \`TAVILY_API_KEY\` to be configured.

**Parameters:**
- \`query\` (string, required): The search query
- \`maxResults\` (number, optional): Maximum number of results (default: 10)
- \`searchDepth\` (string, optional): \`"basic"\` (faster, default) or \`"advanced"\` (more thorough)
- \`includeAnswer\` (boolean, optional): Include a short AI-generated answer at the top (default: false)

**Note:** Use \`searchDepth: "basic"\` for speed; \`"advanced"\` for more comprehensive results.`,

  DESC_CHECK_DOMAIN: `**Check Domain Availability**

**JSON Format:**
"{
  "type": "action",
  "variant": "checkDomain",
  "parameters": {
    "domains": ["example.com", "example.io"]
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Checks whether domain names are registered or available, using the RDAP registry protocol (with DNS as fallback). No API key required. Use this instead of web search whenever the user asks if a domain is taken or can be registered.

**Parameters:**
- \`domains\` (string[], required): One or more domain names to check (max 25 per call). Bare domains like \`"gadgetai.com"\`, no protocol or path.

**Result:** Per-domain status: \`available\`, \`registered\` (with registrar when known), or \`unknown\`.`,

  DESC_READ_DOCUMENT: `**Read Document**

**JSON Format:**
"{
  "type": "action",
  "variant": "readDocument",
  "parameters": {
    "resourceUrl": "https://docs.google.com/document/d/YOUR_DOC_ID/edit"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Reads the content of a document from your connected integrations (Google Docs or Notion).

**Parameters:**
- \`resourceUrl\` (string, required): The URL of the document (must be added as a resource in your Resources panel)

**Requirements:**
- Resource must be added in the Resources panel
- Process must have access to the resource (global or specific)
- Integration (Google Docs or Notion) must be connected

**Note:** Returns the document content as markdown text.`,

  DESC_WRITE_DOCUMENT: `**Write Document**

**JSON Format:**
"{
  "type": "action",
  "variant": "writeDocument",
  "parameters": {
    "resourceUrl": "https://docs.google.com/document/d/YOUR_DOC_ID/edit",
    "content": "New content to write",
    "mode": "replace"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Writes content to a document in your connected integrations (Google Docs or Notion). Supports full replacement, appending, or selective range-based updates.

**Parameters:**
- \`resourceUrl\` (string, required): The URL of the document (must be added as a resource in your Resources panel)
- \`content\` (string, required): The content to write to the document
- \`mode\` (string, optional): Write mode:
  - \`"replace"\` (default): Replaces all content with new content
  - \`"append"\`: Adds content to the end of the document
  - \`"selective"\`: Replaces content in a specific range (requires \`range\` parameter)
- \`range\` (object, required for selective mode): Specifies the range to replace
  - \`startIndex\` (number): Start position (for Google Docs: character index, for Notion: block index)
  - \`endIndex\` (number): End position (for Google Docs: character index, for Notion: block index)

**Requirements:**
- Resource must be added in the Resources panel
- Process must have access to the resource (global or specific)
- Integration (Google Docs or Notion) must be connected

**Note:** 
- For Google Docs, content is written as plain text and indices refer to character positions
- For Notion, content supports markdown formatting and indices refer to block positions
- Use the Read Document action first if you need to determine the correct range indices`,

  DESC_FORMAT_DOCUMENT: `**Format Document**

**JSON Format:**
"{
  "type": "action",
  "variant": "formatDocument",
  "parameters": {
    "resourceUrl": "https://docs.google.com/document/d/YOUR_DOC_ID/edit",
    "formatting": {
      "bold": true,
      "italic": false,
      "fontSize": 14
    }
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Applies formatting to text in a Google Doc. Currently only supports Google Docs.

**Parameters:**
- \`resourceUrl\` (string, required): The URL of the document (must be added as a resource in your Resources panel)
- \`formatting\` (object, required): Formatting options to apply
  - \`bold\` (boolean, optional): Make text bold
  - \`italic\` (boolean, optional): Make text italic
  - \`fontSize\` (number, optional): Set font size (in points)
- \`range\` (object, optional): Specific range to format (if omitted, formats entire document)
  - \`startIndex\` (number): Start position
  - \`endIndex\` (number): End position

**Requirements:**
- Resource must be a Google Doc (not supported for Notion)
- Resource must be added in the Resources panel
- Process must have access to the resource
- Google Docs integration must be connected

**Note:** Formatting is applied to the entire document unless a specific range is provided.`,

  DESC_REMOVE_DOCUMENT: `**Remove Document**

**JSON Format:**
"{
  "type": "action",
  "variant": "removeDocument",
  "parameters": {
    "resourceUrl": "https://docs.google.com/document/d/YOUR_DOC_ID/edit"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Deletes or archives a document from the connected integrations and optionally removes the resource from Prism.

**Parameters:**
- \`resourceUrl\` (string, required): The URL of the document (can be directly added as resource or accessible through a parent folder/page)

**Requirements:**
- Document must be accessible (either directly added or child of an added parent resource)
- Integration must be connected

**Note:** 
- Google Drive: Documents are moved to trash and can be recovered
- Notion: Pages are archived and can be recovered from trash
- **Notion Limitation**: Workspace-level pages (pages not inside any parent) cannot be removed via API - the user must move them to a parent page first or remove manually in Notion
- If the document is a direct resource, it will be removed from Prism's database
- Can remove documents that are children of accessible parent resources`,

  DESC_RENAME_DOCUMENT: `**Rename Document**

**JSON Format:**
"{
  "type": "action",
  "variant": "renameDocument",
  "parameters": {
    "resourceUrl": "https://docs.google.com/document/d/YOUR_DOC_ID/edit",
    "newName": "New Document Name"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Renames a document in the connected integrations and updates the resource name in Prism.

**Parameters:**
- \`resourceUrl\` (string, required): The URL of the document (must be added as a resource in the Resources panel)
- \`newName\` (string, required): The new name for the document

**Requirements:**
- Resource must be added in the Resources panel
- Process must have access to the resource
- Integration must be connected

**Note:** 
- The document name is updated in both the service provider and Prism's database`,

  DESC_DUPLICATE_DOCUMENT: `**Duplicate Document**

**JSON Format:**
"{
  "type": "action",
  "variant": "duplicateDocument",
  "parameters": {
    "resourceUrl": "https://docs.google.com/document/d/YOUR_DOC_ID/edit",
    "newName": "Copy of Document"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Creates a copy of a document in the connected integrations and adds it as a new resource in Prism.

**Parameters:**
- \`resourceUrl\` (string, required): The URL of the document to duplicate (must be added as a resource in the Resources panel)
- \`newName\` (string, required): The name for the duplicated document

**Requirements:**
- Resource must be added in the Resources panel
- Process must have access to the resource
- Integration must be connected

**Note:** 
- The new document is created in the same location as the original
- A new resource entry is automatically created in Prism for the duplicated document
- The duplicated document is automatically added to the current process`,

  DESC_ADD_DOCUMENT: `**Add Document**

**JSON Format:**
"{
  "type": "action",
  "variant": "addDocument",
  "parameters": {
    "locationUrl": "https://drive.google.com/drive/folders/FOLDER_ID",
    "documentName": "My New Document",
    "content": "# Introduction\\n\\nContent here...",
    "provider": "google"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Creates a new document in a folder, as a subpage, or in the root/workspace. The document is automatically added as a resource to the current process.

**Parameters:**
- \`locationUrl\` (string, optional): Optional URL of the location resource (must be selected in the process's Resources configuration if provided). For Google Drive: must be a folder resource. For Notion: must be a page resource. If omitted, creates in root/workspace.
- \`documentName\` (string, required): The name for the new document
- \`content\` (string, optional): Optional initial content for the document. For Notion, you can use Markdown syntax
- \`provider\` (string, required): Provider to use. Must be 'google' or 'notion'. When locationUrl is provided, must match the location's provider. When locationUrl is omitted, determines which provider to use for root/workspace creation

**Requirements:**
- If locationUrl is provided, resource must be added in the Resources panel and process must have access to it
- Integration must be connected for the specified provider

**Note:** 
- For Google Drive: creates a new Google Doc in the specified folder, or in root if locationUrl is omitted
- For Notion: creates a new page as a subpage of the specified page, or at workspace root if locationUrl is omitted
- A new resource entry is automatically created in Prism and added to the current process
- If you try to use a Google Doc as a location, the action will fail with a clear error message`,

  DESC_ADD_FOLDER: `**Add Folder**

**JSON Format:**
"{
  "type": "action",
  "variant": "addFolder",
  "parameters": {
    "folderName": "My New Folder",
    "parentUrl": "https://drive.google.com/drive/folders/PARENT_FOLDER_ID",
    "provider": "google"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Creates a new folder or page container in the provider and adds it as a resource in Prism.

**Parameters:**
- \`folderName\` (string, required): The name for the new folder/page
- \`parentUrl\` (string, optional): The URL of the parent folder/page (if omitted, creates in root/workspace). For Google Drive: must be a folder URL. For Notion: must be a page URL.
- \`provider\` (string, required): Provider to use. Must be 'google' or 'notion'

**Requirements:**
- Provider integration must be connected
- If parentUrl is provided, you must have access to that folder/page

**Note:** 
- For Google Drive: creates a folder that can contain documents and other folders
- For Notion: creates a page that can contain subpages and blocks (Notion uses pages as containers similar to folders)
- A new resource entry is automatically created in Prism and added to the current process
- Requires the provider integration to be connected`,

  DESC_CREATE_DATABASE: `**Create Database**

**JSON Format (with parent page):**
"{
  "type": "action",
  "variant": "createDatabase",
  "parameters": {
    "parentPageUrl": "https://www.notion.so/parent-page-id",
    "databaseName": "My Tasks"
  }
}"

**JSON Format (workspace level - no parent):**
"{
  "type": "action",
  "variant": "createDatabase",
  "parameters": {
    "databaseName": "My Tasks"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Creates a new database with a default "Name" property. Can be created at the workspace level (no parent) or as a child of a specific page. The database is automatically added as a resource to the current process. Use the \`updateDatabase\` action to add more properties after creation.

**Parameters:**
- \`parentPageUrl\` (string, optional): The URL of the parent page. If not provided, database is created at workspace level. If provided, parent page must be added as a resource
- \`databaseName\` (string, required): Name for the database

**Requirements:**
- If \`parentPageUrl\` is provided, the parent page must be added as a resource
- Integration must be connected

**Note:** 
- The database is automatically added as a resource to the current process
- Database is created with a default "Name" title property
- Use \`updateDatabase\` action to add additional properties to the schema
- Workspace-level databases appear at the top level of your workspace`,

  DESC_WRITE_DATABASE: `**Write Database**

**JSON Format:**
"{
  "type": "action",
  "variant": "writeDatabase",
  "parameters": {
    "databaseUrl": "https://www.notion.so/database-id?v=view-id",
    "properties": {
      "Name": "My Task",
      "Date": "2026-02-04",
      "Status": "To Do",
      "Tags": ["urgent", "review"],
      "Priority": 5,
      "IsComplete": false
    },
    "content": "# Task Details\\n\\nThis is the content of the page..."
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Creates a new page (row) in a database with the specified properties and optional content. The system automatically detects property types from your database schema and formats values correctly.

**Parameters:**
- \`databaseUrl\` (string, required): The URL of the database (must be added as a resource with type 'database')
- \`properties\` (object, required): Properties for the new page as key-value pairs. Property names must match the database schema exactly (case-sensitive)
- \`content\` (string, optional): Markdown content to add to the page body. Supports headings, paragraphs, lists, etc.

**Supported Property Types:**
- \`title\`: Simple text string (e.g., "My Task")
- \`rich_text\`: Simple text string (e.g., "Description text")
- \`date\`: ISO date format "YYYY-MM-DD" (e.g., "2026-02-04") or with time "YYYY-MM-DDTHH:mm:ss"
- \`number\`: Numeric value (e.g., 42 or 3.14)
- \`select\`: Option name as string (e.g., "To Do") - must exist in database
- \`multi_select\`: Array of option names (e.g., ["tag1", "tag2"]) or single string
- \`checkbox\`: Boolean value (e.g., true or false)
- \`url\`: URL string (e.g., "https://example.com")
- \`email\`: Email string (e.g., "user@example.com")
- \`phone_number\`: Phone string (e.g., "+1234567890")

**Requirements:**
- Integration must be connected
- Property names must match the database column names exactly (case-sensitive)
- Property values are automatically formatted based on the database schema

**Important Notes:**
- Database properties (columns) can only hold short metadata values
- For long-form content (articles, descriptions), use the \`content\` parameter which adds text to the page body
- Properties that don't exist in the database schema will be skipped with a warning
- The new page is NOT automatically added as a resource
- Content supports markdown syntax (headings with #, ##, paragraphs, lists)
- You can create child pages inside this page using the \`addDocument\` action with the returned page URL`,

  // TEMPORARILY HIDDEN - Update Database action
  // DESC_UPDATE_DATABASE_PAGE: `**Update Database**
  //
  // **JSON Format:**
  // "{
  //   "type": "action",
  //   "variant": "updateDatabase",
  //   "parameters": {
  //     "pageUrl": "https://www.notion.so/page-id",
  //     "properties": {
  //       "Status": "Done",
  //       "Priority": "Low"
  //     }
  //   }
  // }"
  //
  // *(Quotation marks added to escape execution - this is documentation only)*
  //
  // **Description:**
  // Updates properties of an existing page in a database.
  //
  // **Parameters:**
  // - \`pageUrl\` (string, required): The URL of the database page to update
  // - \`properties\` (object, required): Properties to update as key-value pairs. Property names must match the database schema exactly (case-sensitive)
  //
  // **Requirements:**
  // - Parent database must be added as a resource
  // - Page must be a database page (not a regular page)
  // - Integration must be connected
  // - Property names must match the database schema exactly
  //
  // **Note:** 
  // - The action automatically formats property values based on the database schema
  // - Properties that don't exist in the database schema will be skipped with a warning
  // - Only properties specified in the \`properties\` object are updated; others remain unchanged
  // - Property values should match the expected type (e.g., text for title, boolean for checkbox, etc.)
  // - To clear a property, use \`null\` as the value (for select, date, url, email, phone_number types)`,

  // TEMPORARILY COMMENTED OUT - Read, Update, Delete Database actions
  DESC_READ_DATABASE: `**Read Database**

**JSON Format:**
"{
  "type": "action",
  "variant": "readDatabase",
  "parameters": {
    "databaseUrl": "https://www.notion.so/database-id?v=view-id"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Reads the schema and properties of a database.

**Parameters:**
- \`databaseUrl\` (string, required): The URL of the database (must be added as a resource with type 'database')

**Requirements:**
- Integration must be connected

**Returns:**
Database title, URL, and a list of all properties with their types.

**Note:** 
- Returns the database schema (columns/fields), not the data/rows
- Use this to understand the database structure before updating`,


  DESC_UPDATE_DATABASE: `**Update Database**

**JSON Format:**
"{
  "type": "action",
  "variant": "updateDatabase",
  "parameters": {
    "databaseUrl": "https://www.notion.so/database-id?v=view-id",
    "databaseName": "Updated Tasks",
    "properties": {
      "Tags": {
        "multi_select": {
          "options": [
            { "name": "Important", "color": "red" },
            { "name": "Urgent", "color": "orange" }
          ]
        }
      }
    }
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Updates the name and/or schema of a database. Can rename the database or add/modify properties.

**Parameters:**
- \`databaseUrl\` (string, required): The URL of the database (must be added as a resource with type 'database')
- \`databaseName\` (string, optional): New name for the database
- \`properties\` (object, optional): Properties to add or update in the schema

**Requirements:**
- Integration must be connected
- At least one of \`databaseName\` or \`properties\` must be provided

**Note:** 
- When adding properties, existing properties are preserved
- Updating existing properties will merge/overwrite them
- Resource name is automatically updated if database is renamed
- Cannot delete properties via this action`,


  DESC_DELETE_DATABASE: `**Delete Database**

**JSON Format:**
"{
  "type": "action",
  "variant": "deleteDatabase",
  "parameters": {
    "databaseUrl": "https://www.notion.so/database-id?v=view-id"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Moves a database to trash and removes it from resources.

**Parameters:**
- \`databaseUrl\` (string, required): The URL of the database to delete (must be accessible - either added as a resource or a child of a page resource)

**Requirements:**
- Integration must be connected
- Database must be accessible (directly or through parent page resource)
- **IMPORTANT:** The database must be inside a page (not at workspace level) - the Notion API does not support archiving workspace-level databases

**Note:** 
- Databases are moved to trash rather than permanently deleted
- The database can be recovered from Notion trash
- If the database was explicitly added as a resource, it will be permanently removed from the system's resource list
- Workspace-level databases cannot be archived via API and must be archived manually in Notion`,

  DESC_DUPLICATE_DATABASE: `**Duplicate Database**

**JSON Format:**
"{
  "type": "action",
  "variant": "duplicateDatabase",
  "parameters": {
    "databaseUrl": "https://www.notion.so/database-id?v=view-id",
    "newDatabaseName": "Tasks (Copy)"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Duplicates a database, copying its schema/properties but not the rows/pages.

**Parameters:**
- \`databaseUrl\` (string, required): The URL of the database to duplicate (must be added as a resource with type 'database')
- \`newDatabaseName\` (string, optional): Name for the duplicated database. If not provided, adds "(Copy)" to the original name

**Requirements:**
- Integration must be connected

**Returns:**
URL of the newly created database.

**Note:** 
- Only duplicates the database schema (columns/properties), not the data/rows
- The new database will be created in the same location as the original`,

  DESC_DB_FIND: `**DB Find**

**JSON Format:**
"{
  "type": "action",
  "variant": "dbFind",
  "parameters": {
    "resourceUrl": "mydb.mycollection",
    "filter": { "status": "active" },
    "sort": { "createdAt": -1 },
    "limit": 10,
    "projection": { "title": 1, "summary": 1 }
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Queries documents from a MongoDB collection. Works with any resource that has provider \`mongodb\`.

**Parameters:**
- \`resourceUrl\` (string, required): The resource URL in the form \`databaseName.collectionName\` (must be added as a resource with type 'collection')
- \`filter\` (object, optional): MongoDB query filter. Use \`{}\` to match all documents
- \`sort\` (object, optional): Sort order, e.g. \`{ "createdAt": -1 }\` for newest first
- \`limit\` (number, optional): Maximum documents to return (default 20, max 100)
- \`projection\` (object, optional): Fields to include (\`1\`) or exclude (\`0\`)

**Returns:**
Array of matching documents.

**Note:**
- The resource must be linked to this process
- Collection name is always resolved from the registered resource - never pass a raw collection name`,

  DESC_DB_INSERT: `**DB Insert**

**JSON Format:**
"{
  "type": "action",
  "variant": "dbInsert",
  "parameters": {
    "resourceUrl": "mydb.mycollection",
    "document": {
      "title": "Weekly Digest",
      "issuedAt": "2026-04-19T09:00:00Z",
      "topics": ["AI", "Cloud"],
      "summary": "This week in tech..."
    }
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Inserts a single document into a MongoDB collection.

**Parameters:**
- \`resourceUrl\` (string, required): The resource URL in the form \`databaseName.collectionName\`
- \`document\` (object, required): The document to insert. Fill in real values - do not use placeholders

**Returns:**
\`{ "insertedId": "..." }\`

**Note:**
- \`_id\` is auto-generated by MongoDB - do not include it
- Always fill in actual values before executing; never pass placeholder strings like "[current date]"`,

  DESC_DB_UPDATE: `**DB Update**

**JSON Format:**
"{
  "type": "action",
  "variant": "dbUpdate",
  "parameters": {
    "resourceUrl": "mydb.mycollection",
    "filter": { "title": "Weekly Digest" },
    "update": { "$set": { "status": "archived" } },
    "multi": false,
    "upsert": false
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Updates one or more documents in a MongoDB collection using MongoDB update operators.

**Parameters:**
- \`resourceUrl\` (string, required): The resource URL in the form \`databaseName.collectionName\`
- \`filter\` (object, required): MongoDB query filter to select documents to update
- \`update\` (object, required): MongoDB update operators (e.g. \`{ "$set": {...} }\`, \`{ "$push": {...} }\`). Plain document replacement is not allowed
- \`multi\` (boolean, optional): If \`true\`, update all matching documents (default \`false\`)
- \`upsert\` (boolean, optional): If \`true\`, insert a new document if no match found (default \`false\`)

**Returns:**
\`{ "matchedCount": N, "modifiedCount": N }\``,

  DESC_DB_DELETE: `**DB Delete**

**JSON Format:**
"{
  "type": "action",
  "variant": "dbDelete",
  "parameters": {
    "resourceUrl": "mydb.mycollection",
    "filter": { "status": "archived" },
    "multi": false,
    "confirm": true
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Deletes one or more documents from a MongoDB collection.

**Parameters:**
- \`resourceUrl\` (string, required): The resource URL in the form \`databaseName.collectionName\`
- \`filter\` (object, required): MongoDB query filter - must not be empty \`{}\`
- \`multi\` (boolean, optional): If \`true\`, delete all matching documents (default \`false\`)
- \`confirm\` (boolean, required): Must be \`true\` to confirm the delete. Action will fail if omitted or \`false\`

**Returns:**
\`{ "deletedCount": N }\`

**Note:**
- Empty filter \`{}\` is rejected to prevent accidental full-collection deletion
- Always include \`"confirm": true\` explicitly`,

  DESC_RUN_CODE: `**Run Code**

**JSON Format:**
"{
  "type": "action",
  "variant": "runCode",
  "parameters": {
    "code": "console.log('Hello, world!')",
    "timeout": 30000
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Executes JavaScript code in a Node.js sandbox and returns stdout, stderr, exit code, and execution time. Use this for calculations, data transformations, or any task that benefits from running actual code.

**Parameters:**
- \`code\` (string, required): The JavaScript code to execute. Use \`console.log()\` to produce output - the result is captured in \`data.stdout\`.
- \`timeout\` (number, optional): Maximum execution time in milliseconds (default: 30000).

**Note:** Output is capped at 100 KB.`,

  DESC_RUN_SHELL: `**Run Shell**

**JSON Format:**
"{
  "type": "action",
  "variant": "runShell",
  "parameters": {
    "command": "ls -la",
    "timeout": 30000
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Executes a shell command in an isolated sandbox and returns stdout, stderr, and exit code. Use this for file operations, running installed CLIs (git, npm, curl, etc.), or any task better suited to a shell command than JavaScript.

**Parameters:**
- \`command\` (string, required): The shell command to execute.
- \`timeout\` (number, optional): Maximum execution time in milliseconds (default: 30000).

**Note:** Output is capped at 100 KB`,

  DESC_ASK_USER_INPUT: `**Ask User for Input**

**JSON Format:**
"{
  "type": "action",
  "variant": "askUserInput",
  "parameters": {
    "message": "Optional message shown to the user"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Pauses process execution and waits for the user to type a response. Use this when you need additional information or confirmation from the user before continuing.

**Parameters:**
- \`message\` (string, optional): A message or question to display to the user while waiting for their input.

**Note:** The action result is shown to the user, and execution resumes automatically when they send their next message.`,

  DESC_REMOVE_FOLDER: `**Remove Folder**

**JSON Format:**
"{
  "type": "action",
  "variant": "removeFolder",
  "parameters": {
    "folderUrl": "https://drive.google.com/drive/folders/YOUR_FOLDER_ID"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Deletes or archives a folder/page from the provider and optionally removes the resource from Prism.

**Parameters:**
- \`folderUrl\` (string, required): The URL of the folder/page to remove (can be directly added as resource or accessible through a parent folder/page)

**Requirements:**
- Folder/page must be accessible (either directly added or child of an added parent resource)
- Provider integration must be connected

**Note:** 
- Google Drive: Folders are moved to trash and can be recovered
- Notion: Pages are archived and can be recovered from trash
- **Notion Limitation**: Workspace-level pages (pages not inside any parent) cannot be removed via API - you must move them to a parent page first or remove manually in Notion
- If the folder/page is a direct resource, it will be removed from Prism's database
- Can remove folders/pages that are children of accessible parent resources`,

  DESC_RENAME_FOLDER: `**Rename Folder**

**JSON Format:**
"{
  "type": "action",
  "variant": "renameFolder",
  "parameters": {
    "folderUrl": "https://drive.google.com/drive/folders/YOUR_FOLDER_ID",
    "newName": "New Folder Name"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Renames a folder in the connected integrations and updates the resource name in Prism.

**Parameters:**
- \`folderUrl\` (string, required): The URL of the folder/page to rename (must be added as a resource in the Resources panel)
- \`newName\` (string, required): The new name for the folder/page

**Requirements:**
- Resource must be added in the Resources panel
- Process must have access to the resource
- Provider integration must be connected

**Note:** 
- The folder/page name is updated in both the integration (Google Drive or Notion) and Prism's database
- For Notion pages, the URL is also updated to reflect the new title slug
- Supports both Google Drive folders and Notion pages`,

  DESC_READ_FOLDER: `**Read Folder**

**JSON Format:**
"{
  "type": "action",
  "variant": "readFolder",
  "parameters": {
    "folderUrl": "https://drive.google.com/drive/folders/YOUR_FOLDER_ID"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Lists the contents of a folder or page from the connected integrations.

**Parameters:**
- \`folderUrl\` (string, required): The URL of the folder or page resource (must be added as a resource in the Resources panel)

**Requirements:**
- Resource must be added in the Resources panel
- Process must have access to the resource
- Provider integration must be connected

**Returns:**
- For Google Drive folders: List of files and subfolders with their names, types, URLs, and mimeTypes
- For Notion pages: Page content and list of child pages with their titles and URLs

**Note:** 
- For Google Drive: Returns files and folders that the app has access to (files created by the app or explicitly selected via Google Picker)
- For Notion: Returns the page content plus all child pages
- Due to Google Drive's security model, only files the user has explicitly granted access to will be visible
- The corresponding integration must be connected`,

  RESOURCES: `Lists all resources available to this process. Returns a JSON array with id, name, type, provider, and URL for each resource.

**Example output:**
[
  {
    "id": "cm1abc123def456gh",
    "name": "My Document",
    "type": "document",
    "provider": "google_drive",
    "url": "https://docs.google.com/document/d/..."
  },
  {
    "id": "cm1xyz789ghi012jk",
    "name": "Project Notes",
    "type": "document",
    "provider": "notion",
    "url": "https://www.notion.so/..."
  }
]

**Usage:**
Reference this variable in your prompts when you need to know which resources are available, or pass it to the LLM to help it decide which document to read/write. Actions addressed by id rather than url (readMdFile, writeMdFile, readData, attachFile, and their siblings) need the exact \`id\` value shown here, not the \`url\` or \`name\`.

**Resource Types:**
- document: All document-based resources
- data: Real file content (images, PDFs, etc.) stored directly on the resource, addressed by id, see readData/writeData/attachFile. Writing $ followed by a data resource's id in a prompt sends the actual file to the model with that prompt (images and PDFs where the model reads them natively, text files as text)

**Providers:**
- google_drive: Google Docs documents
- notion: Notion pages

**Note:** Resources must be added in the Resources panel and either marked as global or assigned to this specific process.`,

  DATETIME: `Returns the current date and time in a human-readable format based on the server's timezone.

**Example output:**
November 27, 2025 at 2:30:45 PM GMT-5

**Usage:**
Use this variable to include the current timestamp in your prompts or content. This is particularly useful for creating dated entries, logging, or time-sensitive content.

**Format:**
The timestamp includes:
- Full month name and day (November 27, 2025)
- Time in 12-hour format with AM/PM (2:30:45 PM)
- Timezone abbreviation (GMT-5, PST, EST, etc.)

**Note:** The timestamp is generated when the process starts execution and remains constant throughout the run.`,

  STARTERPROMPT: `You have access to these actions: $DESC_ALL_ACTIONS. Also you have access to these resources: $RESOURCES. The current date/time is: $DATETIME

The following actions are only available if this process is running in the Prism Native "Editor" app:

$DESC_EDITOR_ACTIONS`,

  DESC_EDITOR_FIX_SPELLING_GRAMMAR: `**Fix Spelling & Grammar** (Editor app only)

**JSON Format:**
"{
  "type": "editorAction",
  "variant": "fixSpellingGrammar",
  "parameters": {
    "selectedText": "The text to correct.",
    "from": 0,
    "to": 20
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Fixes spelling and grammar errors in the selected editor text and automatically applies the result back to the editor.

**Parameters:**
- \`selectedText\` (string, optional): The text to correct. If omitted, uses the active editor selection
- \`from\` (number, optional): Start character index in the editor for the target range
- \`to\` (number, optional): End character index in the editor for the target range

**Note:** An active editor selection always takes priority over \`from\`/\`to\` indexes. If neither is provided, the result is inserted at the cursor position.`,

  DESC_EDITOR_REWRITE: `**Rewrite** (Editor app only)

**JSON Format:**
"{
  "type": "editorAction",
  "variant": "rewrite",
  "parameters": {
    "selectedText": "The text to rewrite.",
    "from": 0,
    "to": 20
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Rewrites the selected editor text for improved clarity and flow, and automatically applies the result back to the editor.

**Parameters:**
- \`selectedText\` (string, optional): The text to rewrite. If omitted, uses the active editor selection
- \`from\` (number, optional): Start character index in the editor for the target range
- \`to\` (number, optional): End character index in the editor for the target range

**Note:** An active editor selection always takes priority over \`from\`/\`to\` indexes. If neither is provided, the result is inserted at the cursor position.`,

  DESC_EDITOR_EXTEND: `**Extend Text** (Editor app only)

**JSON Format:**
"{
  "type": "editorAction",
  "variant": "extendText",
  "parameters": {
    "selectedText": "Brief text to expand.",
    "from": 0,
    "to": 21
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Expands the selected editor text with more detail and depth, and automatically applies the result back to the editor.

**Parameters:**
- \`selectedText\` (string, optional): The text to expand. If omitted, uses the active editor selection
- \`from\` (number, optional): Start character index in the editor for the target range
- \`to\` (number, optional): End character index in the editor for the target range

**Note:** An active editor selection always takes priority over \`from\`/\`to\` indexes. If neither is provided, the result is inserted at the cursor position.`,

  DESC_EDITOR_ADD: `**Add Text** (Editor app only)

**JSON Format:**
"{
  "type": "editorAction",
  "variant": "addText",
  "parameters": {
    "text": "The exact text to append at the end of the document."
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Appends a literal string to the end of the document instantly. No LLM call is made - the text is inserted exactly as provided.

**Parameters:**
- \`text\` (string, required): The exact text to append to the end of the document.`,

  DESC_EDITOR_REMOVE: `**Remove Text** (Editor app only)

**JSON Format:**
"{
  "type": "editorAction",
  "variant": "removeText",
  "parameters": {
    "from": 0,
    "to": 19
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Deletes a character range from the editor instantly. No LLM call is made - the range is removed exactly as specified.

**Parameters:**
- \`from\` (number, required): Start character index of the range to delete.
- \`to\` (number, required): End character index of the range to delete.`,

  DESC_EDITOR_REDUCE: `**Reduce Text** (Editor app only)

**JSON Format:**
"{
  "type": "editorAction",
  "variant": "reduceText",
  "parameters": {
    "selectedText": "A longer passage to condense.",
    "from": 0,
    "to": 28
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Condenses the selected editor text while preserving key points, and automatically applies the result back to the editor.

**Parameters:**
- \`selectedText\` (string, optional): The text to condense. If omitted, uses the active editor selection
- \`from\` (number, optional): Start character index in the editor for the target range
- \`to\` (number, optional): End character index in the editor for the target range

**Note:** An active editor selection always takes priority over \`from\`/\`to\` indexes. If neither is provided, the result is inserted at the cursor position.`,

  DESC_EDITOR_SIMPLIFY: `**Simplify Text** (Editor app only)

**JSON Format:**
"{
  "type": "editorAction",
  "variant": "simplify",
  "parameters": {
    "selectedText": "Complex text to simplify.",
    "from": 0,
    "to": 25
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Rewrites the selected editor text in simpler, more accessible language, and automatically applies the result back to the editor.

**Parameters:**
- \`selectedText\` (string, optional): The text to simplify. If omitted, uses the active editor selection
- \`from\` (number, optional): Start character index in the editor for the target range
- \`to\` (number, optional): End character index in the editor for the target range

**Note:** An active editor selection always takes priority over \`from\`/\`to\` indexes. If neither is provided, the result is inserted at the cursor position.`,

  DESC_EDITOR_COMPLETE: `**Complete Sentence** (Editor app only)

**JSON Format:**
"{
  "type": "editorAction",
  "variant": "completeSentence",
  "parameters": {
    "selectedText": "Incomplete text to continue",
    "from": 0,
    "to": 26
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Continues and completes the selected editor text naturally, and automatically applies the result back to the editor.

**Parameters:**
- \`selectedText\` (string, optional): The incomplete text to continue. If omitted, uses the active editor selection
- \`from\` (number, optional): Start character index in the editor for the target range
- \`to\` (number, optional): End character index in the editor for the target range

**Note:** An active editor selection always takes priority over \`from\`/\`to\` indexes. If neither is provided, the result is inserted at the cursor position.`,

  DESC_EDITOR_TRANSLATE: `**Translate Text** (Editor app only)

**JSON Format:**
"{
  "type": "editorAction",
  "variant": "translate",
  "parameters": {
    "selectedText": "Text to translate.",
    "language": "Spanish",
    "from": 0,
    "to": 18
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Translates the selected editor text to the specified target language, and automatically applies the result back to the editor.

**Parameters:**
- \`language\` (string, required): The target language to translate into (e.g. "Spanish", "French", "German")
- \`selectedText\` (string, optional): The text to translate. If omitted, uses the active editor selection
- \`from\` (number, optional): Start character index in the editor for the target range
- \`to\` (number, optional): End character index in the editor for the target range

**Note:** An active editor selection always takes priority over \`from\`/\`to\` indexes. If neither is provided, the result is inserted at the cursor position.`,

  DESC_EDITOR_FORMAT_TEXT: `**Format Text** (Editor app only)

**JSON Format:**
"{
  "type": "editorAction",
  "variant": "formatText",
  "parameters": {
    "from": 0,
    "to": 29,
    "format": "bold"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Applies inline formatting (bold, italic, underline, font size, color, etc.) to a character range in the editor instantly. No LLM call is made - formatting is applied directly.

**Parameters:**
- \`format\` (string, optional): One of \`"bold"\`, \`"italic"\`, \`"underline"\`, \`"strike"\`, \`"highlight"\` - toggles that mark on the selection
- \`color\` (string, optional): Hex color to apply to the text (e.g. \`"#ff0000"\`)
- \`fontSize\` (string, optional): Font size in px (e.g. \`"18px"\`)
- \`clearAll\` (boolean, optional): Remove all inline formatting from the selection
- \`from\` / \`to\` (number, optional): Character range in the editor

**Note:** An active editor selection always takes priority over \`from\`/\`to\` indexes.`,

  DESC_EDITOR_DIRECTIVE: `**Editor Directive** (Editor app only)

**JSON Format:**
"{
  "type": "editorAction",
  "variant": "directive",
  "parameters": {
    "selectedText": "Text to transform.",
    "directive": "Make this more formal and professional",
    "from": 0,
    "to": 18
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Applies any custom transformation instruction to the selected editor text and automatically applies the result back to the editor. Use this for any editing task not covered by the other editor actions.

**Parameters:**
- \`directive\` (string, required): The custom instruction describing what transformation to apply
- \`selectedText\` (string, optional): The text to transform. If omitted, uses the active editor selection
- \`from\` (number, optional): Start character index in the editor for the target range
- \`to\` (number, optional): End character index in the editor for the target range

**Note:** An active editor selection always takes priority over \`from\`/\`to\` indexes. If neither is provided, the result is inserted at the cursor position.`,

  // DEACTIVATED: Crawl is too powerful for current use case
  // If brought back, rename to "Crawl complete website"
  /* DESC_CRAWL: `**Crawl Multiple Pages**

**JSON Format:**
{
"type": "crawl",
"parameters": {
  "url": "https://example.com",
  "limit": 10,
  "maxDepth": 2,
  "includePaths": ["blog/*", "docs/*"],
  "scrapeOptions": {
    "formats": ["markdown"]
  }
}
}

**Description:**
Crawls multiple pages from a website following links and returns content from all pages.

**Parameters:**
- \`url\` (string, required): The starting URL to crawl
- \`limit\` (number, optional): Maximum number of pages to crawl
- \`maxDepth\` (number, optional): Maximum depth to follow links
- \`allowBackwardLinks\` (boolean, optional): Allow crawling backward in URL path
- \`allowExternalLinks\` (boolean, optional): Allow crawling external domains
- \`allowSubdomains\` (boolean, optional): Allow crawling subdomains
- \`crawlEntireDomain\` (boolean, optional): Crawl entire domain including sibling paths
- \`ignoreSitemap\` (boolean, optional): Ignore the website's sitemap
- \`includePaths\` (array, optional): URL patterns to include (glob patterns, e.g., ["blog/*"])
- \`excludePaths\` (array, optional): URL patterns to exclude (glob patterns, e.g., ["admin/*"])
- \`maxFileSize\` (number, optional): Maximum file size in bytes to crawl
- \`webhook\` (object, optional): Webhook configuration for real-time notifications
- \`scrapeOptions\` (object, optional): Options for scraping each page (same as scrape action)`, */

  DESC_READ_MD_FILE: `**Read MD File**

**JSON Format:**
"{
  "type": "action",
  "variant": "readMdFile",
  "parameters": {
    "id": "cm1abc123def456gh"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Reads the content of a local Markdown (.md) file that has been registered as a resource in this process.

**Parameters:**
- \`id\` (string, required): The resource id of the MD file (the id field from the resources list you were given, not its name or url)

**Requirements:**
- The file must be added as an \`md_file\` resource in the Resources panel
- The file must exist on the server filesystem

**Note:** Returns the file content as a string. If the file is large it may be truncated.`,

  DESC_WRITE_MD_FILE: `**Write MD File**

**JSON Format:**
"{
  "type": "action",
  "variant": "writeMdFile",
  "parameters": {
    "id": "cm1abc123def456gh",
    "content": "# Title\\n\\nContent here...",
    "mode": "replace"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Writes content to a local Markdown (.md) file that has been registered as a resource in this process.

**Parameters:**
- \`id\` (string, required): The resource id of the MD file (the id field from the resources list you were given, not its name or url)
- \`content\` (string, required): The Markdown content to write
- \`mode\` (string, optional): Write mode:
  - \`"replace"\` (default): Replaces the entire file content
  - \`"append"\`: Appends content to the end of the file

**Requirements:**
- The file must be added as an \`md_file\` resource in the Resources panel

**Note:** Use standard Markdown syntax for formatting.`,

  DESC_CREATE_MD_FILE: `**Create MD File**

**JSON Format:**
"{
  "type": "action",
  "variant": "createMdFile",
  "parameters": {
    "name": "My New File",
    "content": "# My New File\\n\\nInitial content..."
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Creates a new local Markdown (.md) file at the specified path. The file is automatically registered as a resource in the current process.

**Parameters:**
- \`name\` (string, required): The name for the new MD file
- \`content\` (string, optional): Initial Markdown content for the new file. If omitted, creates an empty file.

**Note:**
- The directory containing the file must already exist
- If a file already exists at the path, it will be overwritten
- The new file is automatically added as a resource to the current process`,

  DESC_DELETE_MD_FILE: `**Delete MD File**

**JSON Format:**
"{
  "type": "action",
  "variant": "deleteMdFile",
  "parameters": {
    "id": "cm1abc123def456gh"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Permanently deletes a local Markdown (.md) file that has been registered as a resource in this process.

**Parameters:**
- \`id\` (string, required): The resource id of the MD file to delete (the id field from the resources list you were given, not its name or url)

**Requirements:**
- The file must be added as an \`md_file\` resource in the Resources panel

**Note:** This action permanently deletes the file. It cannot be undone. The resource entry is also removed from Prism.`,

  DESC_RENAME_MD_FILE: `**Rename MD File**

**JSON Format:**
"{
  "type": "action",
  "variant": "renameMdFile",
  "parameters": {
    "id": "cm1abc123def456gh",
    "newName": "New Name"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Renames or moves a local Markdown (.md) file. The resource entry in Prism is updated to reflect the new path.

**Parameters:**
- \`id\` (string, required): The resource id of the MD file (the id field from the resources list you were given, not its name or url)
- \`newName\` (string, required): The new name for the file

**Requirements:**
- The file must be added as an \`md_file\` resource in the Resources panel

**Note:** If moving to a different directory, the destination directory must already exist.`,

  DESC_DUPLICATE_MD_FILE: `**Duplicate MD File**

**JSON Format:**
"{
  "type": "action",
  "variant": "duplicateMdFile",
  "parameters": {
    "id": "cm1abc123def456gh",
    "newName": "Copy of My File"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Creates a copy of a local Markdown (.md) file at a new path. The copy is automatically registered as a new resource in the current process.

**Parameters:**
- \`id\` (string, required): The resource id of the MD file to copy (the id field from the resources list you were given, not its name or url)
- \`newName\` (string, required): The name for the copy

**Requirements:**
- The source file must be added as an \`md_file\` resource in the Resources panel

**Note:**
- The directory for the new path must already exist
- The copy is automatically added as a new resource to the current process`,

  DESC_READ_DATA: `**Read Data**

**JSON Format:**
"{
  "type": "action",
  "variant": "readData",
  "parameters": {
    "id": "cm1abc123def456gh"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Reads a data resource that has been registered in this process: a resource whose content is not a URL reference but real, storable content (any file type, not just text). Returns the content as a base64 string alongside its media type (e.g. "image/png", "application/pdf").

**Parameters:**
- \`id\` (string, required): The resource id of the data resource (the id field from the resources list you were given, not its name or url)

**Requirements:**
- The resource must be added as a \`data\` resource in the Resources panel

**Note:** The returned \`content\` is base64-encoded raw bytes, not text. Decode it according to \`mediaType\` before using it.`,

  DESC_WRITE_DATA: `**Write Data**

**JSON Format:**
"{
  "type": "action",
  "variant": "writeData",
  "parameters": {
    "id": "cm1abc123def456gh",
    "content": "<base64-encoded bytes>",
    "mediaType": "image/png"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Replaces the content of a data resource that has been registered in this process.

**Parameters:**
- \`id\` (string, required): The resource id of the data resource (the id field from the resources list you were given, not its name or url)
- \`content\` (string, required): The new content, base64-encoded
- \`mediaType\` (string, optional): Updates the resource's media type. If omitted, the existing media type is kept.

**Requirements:**
- The resource must be added as a \`data\` resource in the Resources panel`,

  DESC_CREATE_DATA: `**Create Data**

**JSON Format:**
"{
  "type": "action",
  "variant": "createData",
  "parameters": {
    "name": "My Image",
    "content": "<base64-encoded bytes>",
    "mediaType": "image/png"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Creates a new data resource holding real, non-text content (any file type: image, PDF, audio, video, etc.). The resource is automatically registered in the current process.

**Parameters:**
- \`name\` (string, required): The name for the new data resource
- \`content\` (string, required): The content, base64-encoded
- \`mediaType\` (string, required): The media type of the content (e.g. "image/png", "application/pdf")

**Note:** The new resource is automatically added as a resource to the current process.`,

  DESC_DELETE_DATA: `**Delete Data**

**JSON Format:**
"{
  "type": "action",
  "variant": "deleteData",
  "parameters": {
    "id": "cm1abc123def456gh"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Permanently deletes a data resource that has been registered in this process.

**Parameters:**
- \`id\` (string, required): The resource id of the data resource to delete (the id field from the resources list you were given, not its name or url)

**Requirements:**
- The resource must be added as a \`data\` resource in the Resources panel

**Note:** This action permanently deletes the resource. It cannot be undone.`,

  DESC_RENAME_DATA: `**Rename Data**

**JSON Format:**
"{
  "type": "action",
  "variant": "renameData",
  "parameters": {
    "id": "cm1abc123def456gh",
    "newName": "New Name"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Renames a data resource. The resource entry in Prism is updated to reflect the new name.

**Parameters:**
- \`id\` (string, required): The resource id of the data resource (the id field from the resources list you were given, not its name or url)
- \`newName\` (string, required): The new name for the resource

**Requirements:**
- The resource must be added as a \`data\` resource in the Resources panel`,

  DESC_DUPLICATE_DATA: `**Duplicate Data**

**JSON Format:**
"{
  "type": "action",
  "variant": "duplicateData",
  "parameters": {
    "id": "cm1abc123def456gh",
    "newName": "Copy of My Image"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Creates a copy of a data resource, including its content and media type. The copy is automatically registered as a new resource in the current process.

**Parameters:**
- \`id\` (string, required): The resource id of the data resource to copy (the id field from the resources list you were given, not its name or url)
- \`newName\` (string, required): The name for the copy

**Requirements:**
- The source resource must be added as a \`data\` resource in the Resources panel`,

  DESC_ATTACH_FILE: `**Attach File**

**JSON Format:**
"{
  "type": "action",
  "variant": "attachFile",
  "parameters": {
    "id": "cm1abc123def456gh"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Reads a file's real content instead of just extracting its text. Images and PDFs are read by the conversation's own model and come back as a thorough description: all visible text verbatim, plus a detailed description of any images, diagrams, or charts; if that model can't read the file's type, this returns an error saying so (tell the user to switch models, don't retry). Spreadsheets (an .xlsx file or a Google Sheet) come back as their exact contents instead: every sheet (hidden ones marked), raw full-precision values with row numbers and column letters, every formula with its last calculated result, comments, and merged cells; a very large sheet is cut off at a size limit and says so. Works on a \`data\` resource (real content stored directly on the resource) or a Google Drive resource (a Doc, Sheet, Slide, Excel file, or an already-uploaded PDF); a native Doc or Slide is exported to PDF and a native Sheet to .xlsx automatically, no extra step needed. Does not work on Notion resources, folders, databases, or local Markdown files, use readDocument, readFolder, or readDatabase for those instead.

**Parameters:**
- \`id\` (string, required): The resource id (the id field from the resources list you were given, not its name or url)

**Requirements:**
- Only available on hosts that have wired up execution for this action; on others it returns a clear "not supported" error instead of doing anything.

**Note:** For an image or PDF, when the conversation's own model can read that file type natively and the file is small enough (the host sets the limit), the real file also stays attached to the conversation, so later turns see the actual file, not just the description. Otherwise you only get the text description: treat it as the file's real content, and if a later question needs a visual detail it didn't cover, call this again rather than assuming the first description was exhaustive.`,
};

// Generate DESC_EDITOR_ACTIONS by referencing individual editor action variables
export function getDescEditorActions(): string {
  return `**Editor Actions** (available only in the Editor app)

$DESC_EDITOR_FIX_SPELLING_GRAMMAR

---

$DESC_EDITOR_REWRITE

---

$DESC_EDITOR_EXTEND

---

$DESC_EDITOR_REDUCE

---

$DESC_EDITOR_SIMPLIFY

---

$DESC_EDITOR_COMPLETE

---

$DESC_EDITOR_TRANSLATE

---

$DESC_EDITOR_DIRECTIVE

---

$DESC_EDITOR_ADD

---

$DESC_EDITOR_REMOVE

---

$DESC_EDITOR_FORMAT_TEXT`;
}

// Generate DESC_ALL_ACTIONS by referencing other variables
export function getDescAllActions(): string {
  return `**All Available Actions**

$DESC_SEND_EMAIL

---

$DESC_SCRAPE

---

$DESC_SEARCH

---

$DESC_NEWS_SEARCH

---

$DESC_QUICK_SEARCH

---

$DESC_TAVILY_SEARCH

---

$DESC_READ_DOCUMENT

---

$DESC_WRITE_DOCUMENT

---

$DESC_FORMAT_DOCUMENT

---

$DESC_REMOVE_DOCUMENT

---

$DESC_RENAME_DOCUMENT

---

$DESC_DUPLICATE_DOCUMENT

---

$DESC_ADD_DOCUMENT

---

$DESC_ADD_FOLDER

---

$DESC_REMOVE_FOLDER

---

$DESC_RENAME_FOLDER

---

$DESC_READ_FOLDER

---

$DESC_CREATE_DATABASE

---

$DESC_WRITE_DATABASE

---

$DESC_READ_DATABASE

---

$DESC_UPDATE_DATABASE

---

$DESC_DELETE_DATABASE

---

$DESC_DUPLICATE_DATABASE

---

$DESC_DB_FIND

---

$DESC_DB_INSERT

---

$DESC_DB_UPDATE

---

$DESC_DB_DELETE

---

$DESC_RUN_CODE

---

$DESC_RUN_SHELL

---

$DESC_ASK_USER_INPUT

---

$DESC_READ_MD_FILE

---

$DESC_WRITE_MD_FILE

---

$DESC_CREATE_MD_FILE

---

$DESC_DELETE_MD_FILE

---

$DESC_RENAME_MD_FILE

---

$DESC_DUPLICATE_MD_FILE

---

$DESC_READ_DATA

---

$DESC_WRITE_DATA

---

$DESC_CREATE_DATA

---

$DESC_DELETE_DATA

---

$DESC_RENAME_DATA

---

$DESC_DUPLICATE_DATA

---

$DESC_ATTACH_FILE`;
}

// Generate DESC_CHAT_ACTIONS (kept for backward compatibility, now empty)
export function getDescChatActions(): string {
  return '';
}

// Add DESC_EDITOR_ACTIONS, DESC_CHAT_ACTIONS and DESC_ALL_ACTIONS to the generic variables
GENERIC_VARIABLES.DESC_EDITOR_ACTIONS = getDescEditorActions();
GENERIC_VARIABLES.DESC_CHAT_ACTIONS = getDescChatActions();
GENERIC_VARIABLES.DESC_ALL_ACTIONS = getDescAllActions();

// Host-supplied action descriptions. The wording that teaches a model how to call
// each action is prompt tuning rather than protocol, so a host can replace or
// extend the built-in catalog at startup via configureActionDescriptions().
let hostDescriptions: Record<string, string> | null = null;

/**
 * Register the host's action-description catalog. Call once at startup, before
 * executing any process.
 *
 * By default the supplied entries are merged over the built-in catalog, so a host
 * can override individual descriptions. Pass `{ replace: true }` to discard the
 * built-ins entirely and use only what is supplied.
 */
export function configureActionDescriptions(
  descriptions: Record<string, string>,
  options: { replace?: boolean } = {},
): void {
  hostDescriptions = options.replace
    ? { ...descriptions }
    : { ...GENERIC_VARIABLES, ...descriptions };
}

/** Currently active catalog: host-configured if set, else built-in. */
function activeVariables(): Record<string, string> {
  return hostDescriptions ?? GENERIC_VARIABLES;
}

/**
 * Get all generic variables as a record
 */
export function getGenericVariables(): Record<string, string> {
  return { ...activeVariables() };
}

/**
 * Get a specific generic variable by name
 */
export function getGenericVariable(name: string): string | undefined {
  return activeVariables()[name];
}

/**
 * Check if a variable name is a generic variable
 */
export function isGenericVariable(name: string): boolean {
  return name in activeVariables();
}

/**
 * Get variable names (for autocomplete/picker)
 */
export function getGenericVariableNames(): string[] {
  return Object.keys(activeVariables());
}

/**
 * Merge generic variables with user variables
 * User variables take precedence over generic variables
 */
export function mergeVariables(userVariables: Record<string, string>): Record<string, string> {
  return {
    ...activeVariables(),
    ...userVariables,
  };
}
