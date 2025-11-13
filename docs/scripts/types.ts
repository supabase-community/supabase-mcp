/**
 * TypeScript type definitions for MCP client documentation system
 */

export interface DeeplinkConfig {
	url: string;
	buttonImage: string;
	buttonAlt: string;
}

export interface CommandConfig {
	command: string;
	description?: string;
}

export interface ManualConfig {
	configFilePath: string;
	configFormat: 'mcpServers' | 'servers';
	instructions?: string;
}

export interface RegistryConfig {
	listed: boolean;
	listingUrl?: string;
}

export interface ClientInstallation {
	deeplink?: DeeplinkConfig | DeeplinkConfig[];
	command?: CommandConfig;
	manual: ManualConfig;
}

export interface Client {
	id: string;
	name: string;
	description?: string;
	officialDocs?: string;
	installation: ClientInstallation;
	registry?: RegistryConfig;
}

export interface ClientsData {
	clients: Client[];
}

/**
 * Validates that a client object has all required fields
 */
export function validateClient(client: unknown): client is Client {
	if (typeof client !== 'object' || client === null) {
		return false;
	}

	const c = client as Partial<Client>;

	// Check required fields
	if (!c.id || typeof c.id !== 'string') {
		console.error(`Client missing required field: id`);
		return false;
	}

	if (!c.name || typeof c.name !== 'string') {
		console.error(`Client ${c.id} missing required field: name`);
		return false;
	}

	if (!c.installation || typeof c.installation !== 'object') {
		console.error(`Client ${c.id} missing required field: installation`);
		return false;
	}

	if (!c.installation.manual || typeof c.installation.manual !== 'object') {
		console.error(
			`Client ${c.id} missing required field: installation.manual`,
		);
		return false;
	}

	// Validate manual config
	const manual = c.installation.manual;
	if (!manual.configFilePath || typeof manual.configFilePath !== 'string') {
		console.error(
			`Client ${c.id} missing required field: installation.manual.configFilePath`,
		);
		return false;
	}

	if (!manual.configFormat || typeof manual.configFormat !== 'string') {
		console.error(
			`Client ${c.id} missing required field: installation.manual.configFormat`,
		);
		return false;
	}

	return true;
}

/**
 * Validates the entire clients.json data structure
 */
export function validateClientsData(data: unknown): data is ClientsData {
	if (typeof data !== 'object' || data === null) {
		console.error('Invalid clients data: not an object');
		return false;
	}

	const d = data as Partial<ClientsData>;

	if (!Array.isArray(d.clients)) {
		console.error('Invalid clients data: clients is not an array');
		return false;
	}

	return d.clients.every(validateClient);
}
