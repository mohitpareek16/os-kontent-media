/** The accounts the demo build offers on its sign-in screen. Any password works
 * in demo mode; the email picks who you are. Kept tiny and separate so the
 * login page can list them without pulling in the whole mock backend. */
export interface DemoAccount {
  email: string;
  label: string;
  name: string;
  blurb: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: "priya@kontent.media", label: "Owner", name: "Priya Mehta", blurb: "Everything, plus admin" },
  { email: "karan@kontent.media", label: "Team Lead", name: "Karan Verma", blurb: "Leads 3 client pods" },
  { email: "ravi@kontent.media", label: "Video Editor", name: "Ravi Sharma", blurb: "Own edit queue" },
  { email: "dev@kontent.media", label: "QC Reviewer", name: "Dev Nair", blurb: "QC queue" },
  { email: "anita@kontent.media", label: "HR", name: "Anita Rao", blurb: "Team directory" },
];

export const DEMO_ENABLED = import.meta.env.VITE_DEMO === "true";
