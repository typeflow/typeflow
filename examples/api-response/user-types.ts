/** Shape of the (fictional) upstream API response. */
export interface ApiUser {
  id: number;
  firstName: string;
  lastName: string;
  role: "admin" | "member" | "guest";
  contact?: {
    email?: string;
    phone?: string;
  };
  address: {
    city: string;
    country?: string;
  };
  labels: {
    name: string;
    active: boolean;
  }[];
  scores: number[];
}
