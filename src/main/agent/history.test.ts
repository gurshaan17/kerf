import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createProject } from '@kerf/model';
import type { ChatConversation, ProjectSnapshot } from '../../shared/contracts';
import { openDatabase } from '../db';
import { ProjectRepository } from '../projects';
import { AgentService, type AgentServiceOptions } from './service';

it('reopens saved conversations after a database restart and isolates projects', () => {
  const root = mkdtempSync(join(tmpdir(), 'kerf-chat-'));
  let db = openDatabase({ filename: join(root, 'test.db') });
  try {
    const repository = new ProjectRepository({
      database: db.connection,
      projectsRoot: join(root, 'projects'),
    });
    const project = repository.create({ name: 'Saved chat' }).project;
    const conversation: ChatConversation = {
      id: 'chat_saved',
      title: 'Original question',
      updatedAt: 100,
      turns: [
        {
          id: 'turn_saved',
          message: 'Original question',
          text: '**Saved reply**',
          tools: [],
          status: 'done',
          providerLabel: 'Test',
          error: null,
          hint: null,
          durationMs: 10,
        },
        {
          id: 'turn_interrupted',
          message: 'Follow up',
          text: 'Partial',
          tools: [],
          status: 'streaming',
          providerLabel: 'Test',
          error: null,
          hint: null,
          durationMs: null,
        },
      ],
    };
    db.connection
      .prepare('INSERT INTO chat_conversations VALUES (?, ?, ?)')
      .run(conversation.id, project.id, JSON.stringify(conversation));
    db.close();
    db = openDatabase({ filename: join(root, 'test.db') });
    let current = { project } as ProjectSnapshot;
    const options: AgentServiceOptions = {
      database: db.connection,
      projects: { current: () => current },
      providers: {
        chatProvider: () => null,
        chatModel: () => {
          throw new Error('unused');
        },
      },
      tools: {} as AgentServiceOptions['tools'],
      broadcast: () => {},
    };
    const service = new AgentService(options);
    expect(service.conversations()).toHaveLength(1);
    const saved = service.openConversation('chat_saved');
    expect(saved.turns[0]?.text).toBe('**Saved reply**');
    expect(saved.turns[1]?.status).toBe('aborted');
    service.newConversation();
    expect(service.conversations()).toHaveLength(1);
    current = {
      project: createProject({ name: 'Other project' }),
    } as ProjectSnapshot;
    expect(service.conversations()).toEqual([]);
    expect(() => service.openConversation('chat_saved')).toThrow(/not found/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
