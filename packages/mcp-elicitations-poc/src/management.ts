import { randomBytes } from "node:crypto";

type ProjectCreatorInput = {
  name: string;
  organization_id: string;
};

export function createManagementProjectCreator(opts: {
  baseUrl: string;
  token: string;
  region?: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const region = opts.region ?? "us-east-1";

  return async (input: ProjectCreatorInput): Promise<{ id: string }> => {
    const response = await fetchImpl(`${baseUrl}/v1/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        organization_slug: input.organization_id,
        region,
        db_pass: randomBytes(32).toString("base64url"),
      }),
    });

    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, 300);
      throw new Error(
        `Management API project creation failed (${response.status}): ${responseBody}`,
      );
    }

    const project = (await response.json()) as { ref: string };
    // V1ProjectResponse marks id deprecated and names ref as the project ref.
    return { id: project.ref };
  };
}
