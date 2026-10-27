// Skills: folders with a SKILL.md (name, description, instructions) plus optional reference files.
// Like Claude's skills, the model first sees only each skill's name and description, and loads the
// full instructions with the load_skill tool when a task calls for it. That keeps context small.
import { useSyncExternalStore } from 'react';
import { host, type SkillInfo } from '../host';
import { Declined, type Tool } from './tools';

/** Words every skill description has, which say nothing about whether a skill fits. */
const COMMON = new Set(['the', 'and', 'for', 'use', 'user', 'users', 'asks', 'ask', 'when', 'whenever', 'with', 'that', 'this', 'not', 'only', 'other', 'from', 'into', 'about', 'any', 'all', 'you', 'your', 'make', 'write', 'create', 'help', 'want', 'wants', 'need', 'needs', 'show', 'give', 'get']);

let skills: SkillInfo[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const DISABLED_KEY = 'ollama-gui.skillsDisabled';
let disabled: string[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(DISABLED_KEY) || '[]');
  } catch {
    return [];
  }
})();

export async function refreshSkills() {
  const h = host();
  skills = h ? await h.skills.list().catch(() => []) : [];
  loaded = true;
  emit();
}

let snapshot = { skills, disabled, loaded };
const getSnapshot = () => {
  if (snapshot.skills !== skills || snapshot.disabled !== disabled || snapshot.loaded !== loaded) snapshot = { skills, disabled, loaded };
  return snapshot;
};

export function useSkills() {
  const s = useSyncExternalStore((l) => {
    listeners.add(l);
    if (!loaded) refreshSkills();
    return () => listeners.delete(l);
  }, getSnapshot);
  return { ...s, available: !!host() };
}

/** Skills switched off are hidden from every chat and agent. */
export function setSkillEnabled(id: string, on: boolean) {
  disabled = on ? disabled.filter((d) => d !== id) : [...new Set([...disabled, id])];
  try {
    localStorage.setItem(DISABLED_KEY, JSON.stringify(disabled));
  } catch {
    /* storage unavailable */
  }
  emit();
}

export const enabledSkills = (only?: string[]) =>
  skills.filter((s) => !disabled.includes(s.id) && (!only || only.includes(s.id)));

export const NEW_SKILL = `---
name: my-skill
description: What this skill does and when to use it. The model reads this to decide whether to load the skill.
---

# My skill

Step-by-step instructions the model follows when it uses this skill.

## Examples
- Input: …
- Output: …
`;

/** The short list the model always sees. */
export function skillsPrompt(list: SkillInfo[]): string {
  if (!list.length) return '';
  return `# Skills
You have skills: packaged instructions for specific kinds of tasks. Most requests don't need any skill.
Call load_skill only when the user's request is clearly the kind of task a skill's description names, then follow what it returns. If you're unsure whether a skill applies, don't load it. Never load a skill to see what it contains, and never load one for a different kind of task (an email is not a memo, a widget is not a poem).

${list.map((s) => `- ${s.name}: ${s.description || '(no description)'}`).join('\n')}`;
}

const findSkill = (list: SkillInfo[], name: unknown) => {
  const n = String(name ?? '').trim().toLowerCase();
  return list.find((s) => s.name.toLowerCase() === n || s.id === n);
};

/** load_skill and read_skill_file, limited to the given skills. */
export function skillTools(list: SkillInfo[]): Tool[] {
  if (!list.length) return [];
  const names = list.map((s) => s.name);
  return [
    {
      name: 'load_skill',
      label: 'Load skill',
      description: "Load the full instructions of one of your skills. Only for a request that is clearly the kind of task the skill's description names.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', enum: names, description: 'The skill name' },
          matching_words: { type: 'string', description: "Quote the words in the user's request that match the skill's description, for example \"write a memo\"." },
        },
        required: ['name', 'matching_words'],
      },
      summary: (a) => String(a.name ?? ''),
      run: async (a, ctx) => {
        const skill = findSkill(list, a.name);
        if (!skill) return `No skill named "${a.name}". Available: ${names.join(', ')}`;
        // A skill loaded "just in case" pulls the answer off course; ask for the evidence first.
        const quote = String(a.matching_words ?? '').trim().toLowerCase();
        const request = ctx.request?.toLowerCase() ?? '';
        const words = quote.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !COMMON.has(w));
        const about = `${skill.name} ${skill.description}`.toLowerCase();
        const fits = words.some((w) => (!request || request.includes(w)) && about.includes(w.replace(/s$/, '')));
        if (!fits) {
          throw new Declined(`Not loaded: the request doesn't match what ${skill.name} is for ("${skill.description}"). Do the task without it, and don't try to load it again.`);
        }
        const text = `${await host()!.skills.read(skill.id)}\n\n---\n(If this skill doesn't fit what the user asked for, ignore it and do the task normally.)`;
        const files = skill.files.length
          ? `\n\n---\nReference files in this skill (read them with read_skill_file when the instructions point to them):\n${skill.files.map((f) => `- ${f}`).join('\n')}`
          : '';
        return text + files;
      },
    },
    {
      name: 'read_skill_file',
      label: 'Read skill file',
      description: "Read a reference file that belongs to one of your skills, such as a template or example listed by load_skill.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', enum: names, description: 'The skill name' },
          path: { type: 'string', description: 'File path inside the skill, as listed by load_skill' },
        },
        required: ['name', 'path'],
      },
      summary: (a) => `${a.name ?? ''}/${a.path ?? ''}`,
      run: async (a) => {
        const skill = findSkill(list, a.name);
        if (!skill) return `No skill named "${a.name}".`;
        const rel = String(a.path ?? '').replace(/^\/+/, '');
        if (!skill.files.includes(rel)) return `"${rel}" is not a file in ${skill.name}. Files: ${skill.files.join(', ') || 'none'}`;
        return host()!.skills.readFile(skill.id, rel);
      },
    },
  ];
}
