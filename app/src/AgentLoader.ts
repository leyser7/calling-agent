import fs from 'fs/promises';
import path from 'path';
import { parse as parseToml } from 'smol-toml';

export interface Agent {
    name: string;
    language: 'es' | 'en';
    systemPrompt: string;
    voiceId: string;
}

export interface AgentInfo {
    agentId: string;
    name: string;
    language: 'es' | 'en';
}

export class AgentLoader {
    private agents: Map<string, Agent> = new Map();
    private agentsDir: string;
    private initialized: boolean = false;

    constructor(agentsDirectory?: string) {
        this.agentsDir = agentsDirectory || path.join(__dirname, '../agents');
    }

    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            await fs.access(this.agentsDir);
        } catch (error) {

            this.initialized = true;
            return;
        }

        let loadedCount = 0;
        let failedCount = 0;

        try {
            const files = await fs.readdir(this.agentsDir);
            const tomlFiles = files.filter(file => file.endsWith('.toml'));

            if (tomlFiles.length === 0) {
                this.initialized = true;
                return;
            }

            for (const file of tomlFiles) {
                const filePath = path.join(this.agentsDir, file);
                const agentId = path.basename(file, '.toml');

                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    const parsedData = parseToml(content) as any;

                    const warnings: string[] = [];

                    if (!parsedData.name) {
                        warnings.push('missing "name"');
                    }

                    if (!parsedData.language) {
                        warnings.push('missing "language"');
                    }

                    if (!parsedData.systemPrompt) {
                        warnings.push('missing "systemPrompt"');
                    }

                    if (!parsedData.voiceId) {
                        warnings.push('missing "voiceId"');
                    }

                    if (warnings.length > 0) {
                        console.warn(`${file}: ${warnings.join(', ')} - using defaults where possible`);
                    }

                    const agent: Agent = {
                        name: parsedData.name || agentId,
                        language: parsedData.language || 'en',
                        systemPrompt: parsedData.systemPrompt || '',
                        voiceId: parsedData.voiceId || 'carlos'
                    };

                    this.agents.set(agentId, agent);
                    loadedCount++;

                    console.log(`✓ ${agentId}: "${agent.name}" (${agent.language})`);
                } catch (error) {
                    console.warn(`Failed to load agent: ${file}`);
                    console.warn(`Error: ${error instanceof Error ? error.message : String(error)}`);
                    failedCount++;
                }
            }

            if (loadedCount > 0) {
            }

            if (failedCount > 0) {

            }

        } catch (error) {
            console.error(`Error reading agents directory: ${error instanceof Error ? error.message : String(error)}`);
        }

        this.initialized = true;
    }

    public getAgent(agentId: string): Agent | null {
        if (!this.initialized) {

            return null;
        }

        const sanitizedId = path.basename(agentId);
        const agent = this.agents.get(sanitizedId);

        if (agent) {
            return agent;
        }

        return null;
    }

    public getAgentInfo(agentId: string): AgentInfo | null {
        const sanitizedId = path.basename(agentId);
        const agent = this.agents.get(sanitizedId);

        if (!agent) {
            return null;
        }

        return {
            agentId: sanitizedId,
            name: agent.name,
            language: agent.language
        };
    }

    public getAvailableAgentIds(): string[] {
        return Array.from(this.agents.keys());
    }

    public hasAgent(agentId: string): boolean {
        const sanitizedId = path.basename(agentId);
        return this.agents.has(sanitizedId);
    }
}
