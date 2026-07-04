/** `init` — scaffold an example mapping in the current directory. */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

const EXAMPLE_TYPES = `export interface User {
  id: number;
  firstName: string;
  lastName: string;
  contact?: { email?: string };
  labels: { name: string; active: boolean }[];
}
`;

const EXAMPLE_MAPPING = `input user: User from "./user-types"

map {
  id: user.id,
  fullName: user.firstName + " " + user.lastName,
  email: user.contact?.email ?? "unknown",
  activeTags: user.labels[active].name,
}
`;

export async function cmdInit(): Promise<void> {
  const created: string[] = [];
  if (!existsSync('user-types.ts')) {
    await writeFile('user-types.ts', EXAMPLE_TYPES, 'utf8');
    created.push('user-types.ts');
  }
  if (!existsSync('user.typeflow')) {
    await writeFile('user.typeflow', EXAMPLE_MAPPING, 'utf8');
    created.push('user.typeflow');
  }
  if (created.length === 0) {
    console.log(
      'Nothing to do: user-types.ts and user.typeflow already exist.',
    );
    return;
  }
  console.log(`Created ${created.join(', ')}.`);
  console.log(
    'Try: typeflow check user.typeflow && typeflow infer user.typeflow',
  );
}
