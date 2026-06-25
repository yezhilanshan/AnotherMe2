import { promises as fs } from 'fs';
import path from 'path';
import { getRuntimeWorkDir } from '@/lib/server/runtime-data-dir';

const MEMORY_DIR = getRuntimeWorkDir('memories');
const PROFILE_FILE = 'PROFILE.md';
const SUMMARY_FILE = 'SUMMARY.md';
const MAX_CONTEXT_CHARS = 6_000;
const MAX_SUMMARY_CHARS = 12_000;

export interface UserMemory {
  userId: string;
  profile: string;
  summary: string;
  updatedAt: number;
}

export interface RefreshMemoryInput {
  userId: string;
  userMessage?: string | null;
  assistantMessage?: string | null;
  topic?: string | null;
  source?: string | null;
}

function safeSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'anonymous';
}

function userMemoryDir(userId: string): string {
  return path.join(MEMORY_DIR, safeSegment(userId));
}

function filePath(userId: string, fileName: string): string {
  return path.join(userMemoryDir(userId), fileName);
}

async function readText(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

async function writeTextAtomic(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, content, 'utf-8');
  await fs.rename(temp, file);
}

function trimFront(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(value.length - maxChars);
}

function compactLine(value: string | null | undefined, maxChars: number): string {
  return (value || '').replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function defaultProfile(userId: string): string {
  return [
    '# Student Profile',
    '',
    `- User ID: ${userId}`,
    '- Learning preferences: unknown',
    '- Communication style: unknown',
    '- Persistent weak points: none recorded yet',
    '',
  ].join('\n');
}

export async function getUserMemory(userId: string): Promise<UserMemory> {
  const [profile, summary] = await Promise.all([
    readText(filePath(userId, PROFILE_FILE)),
    readText(filePath(userId, SUMMARY_FILE)),
  ]);

  return {
    userId,
    profile: profile || defaultProfile(userId),
    summary,
    updatedAt: Date.now(),
  };
}

export async function updateUserMemory(
  userId: string,
  input: { profile?: string; summary?: string },
): Promise<UserMemory> {
  const current = await getUserMemory(userId);
  const nextProfile = input.profile ?? current.profile;
  const nextSummary = input.summary ?? current.summary;

  await Promise.all([
    writeTextAtomic(filePath(userId, PROFILE_FILE), nextProfile),
    writeTextAtomic(filePath(userId, SUMMARY_FILE), nextSummary),
  ]);

  return {
    userId,
    profile: nextProfile,
    summary: nextSummary,
    updatedAt: Date.now(),
  };
}

export async function buildMemoryContext(userId: string): Promise<string | null> {
  const memory = await getUserMemory(userId);
  const sections: string[] = [];

  if (memory.profile.trim()) {
    sections.push(`## Persistent Student Profile\n${memory.profile.trim()}`);
  }
  if (memory.summary.trim()) {
    sections.push(`## Learning Journey Summary\n${trimFront(memory.summary.trim(), 3_000)}`);
  }

  const context = sections.join('\n\n').trim();
  return context ? context.slice(0, MAX_CONTEXT_CHARS) : null;
}

export async function refreshMemoryFromTurn(input: RefreshMemoryInput): Promise<UserMemory> {
  const current = await getUserMemory(input.userId);
  const user = compactLine(input.userMessage, 500);
  const assistant = compactLine(input.assistantMessage, 700);

  if (!user && !assistant) {
    return current;
  }

  const timestamp = new Date().toISOString();
  const source = input.source || 'chat';
  const topic = compactLine(input.topic, 120) || '未命名学习主题';
  const turnEntry = [
    `## ${timestamp} · ${source} · ${topic}`,
    user ? `- Student asked: ${user}` : '',
    assistant ? `- Tutor responded: ${assistant}` : '',
    '',
  ]
    .filter(Boolean)
    .join('\n');

  const nextSummary = trimFront(`${current.summary.trim()}\n\n${turnEntry}`.trim(), MAX_SUMMARY_CHARS);
  const nextProfile = current.profile.includes('Recent activity:')
    ? current.profile.replace(
        /Recent activity:[^\n]*/,
        `Recent activity: ${timestamp} · ${topic}`,
      )
    : `${current.profile.trim()}\n- Recent activity: ${timestamp} · ${topic}\n`;

  return updateUserMemory(input.userId, {
    profile: nextProfile,
    summary: nextSummary,
  });
}
