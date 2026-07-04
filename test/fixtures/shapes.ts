export interface Nested {
  city: string;
  zip?: string;
}

export interface Person {
  id: number;
  name: string;
  role: 'admin' | 'member';
  active: boolean;
  address: Nested;
  nickname?: string;
  tags: string[];
  friends: Person[];
}

export type MaybeText = string | null;
