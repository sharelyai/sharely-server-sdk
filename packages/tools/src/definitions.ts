import type { ToolDefinition } from '@sharelyai/protocol';

export const searchKnowledgeDefinition: ToolDefinition = {
  name: 'search_knowledge',
  description:
    'Search the workspace knowledge base by keyword or text. Searches across document titles, filenames, and content using text matching. Use this when you know specific keywords or phrases. For conceptual or meaning-based search, use semantic_search instead.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The keyword or text to search for in titles and content',
      },
      limit: {
        type: 'number',
        description:
          'Maximum number of results to return (min: 1, max: 50, default: 10)',
      },
    },
    required: ['query'],
  },
};

export const semanticSearchDefinition: ToolDefinition = {
  name: 'semantic_search',
  description:
    "Perform a semantic similarity search across the workspace knowledge base. This uses vector embeddings to find content that is conceptually similar to the query, even if the exact words don't match. Use this when keyword search doesn't return good results.",
  input_schema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The natural language text to search for',
      },
      topK: {
        type: 'number',
        description:
          'Maximum number of results to return (min: 1, max: 10, default: 10)',
      },
      languageId: {
        type: 'string',
        description: 'Language ID to filter results by a specific language',
      },
    },
    required: ['text'],
  },
};

export const getKnowledgeItemDefinition: ToolDefinition = {
  name: 'get_knowledge_item',
  description:
    'Retrieve the full content of a specific knowledge item by its ID. Use this after searching to get the complete text of a document you need to reference.',
  input_schema: {
    type: 'object',
    properties: {
      knowledgeId: {
        type: 'string',
        description: 'The ID of the knowledge item to retrieve',
      },
    },
    required: ['knowledgeId'],
  },
};

export const listTaxonomiesDefinition: ToolDefinition = {
  name: 'list_taxonomies',
  description:
    'List all published taxonomies in the workspace. Taxonomies organize knowledge into categories and hierarchies. Use this to discover how knowledge is structured before drilling into specific taxonomy content with get_taxonomy_knowledge.',
  input_schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description:
          "Filter by status: 'PUBLISHED', 'DRAFT', 'PUBLISHED_UAT', or 'all'. Defaults to 'PUBLISHED'.",
      },
    },
  },
};

export const getTaxonomyKnowledgeDefinition: ToolDefinition = {
  name: 'get_taxonomy_knowledge',
  description:
    'Get all knowledge items organized under a specific taxonomy. Returns categories and their associated knowledge documents. Use this after list_taxonomies to explore the content within a taxonomy.',
  input_schema: {
    type: 'object',
    properties: {
      taxonomyId: {
        type: 'string',
        description: 'The ID of the taxonomy to retrieve knowledge from',
      },
    },
    required: ['taxonomyId'],
  },
};

export const getWorkspaceStatsDefinition: ToolDefinition = {
  name: 'get_workspace_stats',
  description:
    'Get summary statistics about the workspace including total knowledge items, spaces, and the most recent items. Use this to give the user an overview of their workspace.',
  input_schema: {
    type: 'object',
    properties: {},
  },
};

export const listRolesDefinition: ToolDefinition = {
  name: 'list_roles',
  description:
    'List all RBAC roles defined in the workspace. Use this to understand the access control structure and what roles are available.',
  input_schema: {
    type: 'object',
    properties: {},
  },
};

export const definitions: ToolDefinition[] = [
  searchKnowledgeDefinition,
  semanticSearchDefinition,
  getKnowledgeItemDefinition,
  listTaxonomiesDefinition,
  getTaxonomyKnowledgeDefinition,
  getWorkspaceStatsDefinition,
  listRolesDefinition,
];
