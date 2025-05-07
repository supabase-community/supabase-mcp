import fs from 'node:fs';
import path from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';

const GRAPHQL_ENDPOINT = 'https://supabase.com/docs/api/graphql';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = path.resolve(__dirname, '../__generated__');

async function fetchSchema() {
  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query: `query SchemaQuery { schema }`,
      }),
    });

    assertSuccess(response);
    const data = await response.json();
    assertResponseShape(data);

    // Ensure __generated__ directory exists
    fs.mkdir(
      GENERATED_DIR,
      {
        recursive: true,
      },
      (error) => {
        if (error) throw error;
      }
    );

    // Write the schema to file
    fs.writeFileSync(
      path.resolve(GENERATED_DIR, 'content-api-schema.text'),
      data.data.schema
    );

    console.log(
      'Schema successfully fetched and written to __generated__/content-api-schema.text'
    );
  } catch (error) {
    console.error('Error fetching schema:', error);
    process.exit(1);
  }
}

function assertSuccess(response: Response) {
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
}

function assertResponseShape(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid response type');
  }
  if ('errors' in data) {
    throw data.errors;
  }
  if (
    !('data' in data) ||
    !data.data ||
    typeof data.data !== 'object' ||
    !('schema' in data.data) ||
    typeof data.data.schema !== 'string'
  ) {
    throw new Error('Invalid response shape');
  }
}

const modulePath = fileURLToPath(import.meta.url);
if (argv[1] === modulePath) {
  fetchSchema();
}
