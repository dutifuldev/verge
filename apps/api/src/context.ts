import type { DatabaseConnection } from "@verge/db";

export type ApiContext = {
  connection: DatabaseConnection;
  repositorySlug: string;
  repositoryDefinition: {
    slug: string;
    areas: Array<{
      key: string;
      pathPrefixes: string[];
    }>;
  };
};
