// Branching simulation (PRD 4.6 sim_branching): the path and the verdicts of the choices are scored by code.

export interface SimChoice { id: string; text: string; next: string; verdict: string; explanation: string; normRef: string }
export interface SimNode { id: string; stage: string; speaker: string; text: string; choices: SimChoice[]; freeTextRubric: string; outcome: string }
export interface SimScenario { startNodeId: string; nodes: SimNode[]; roles: { key: string; name: string; startNodeId?: string }[] }

const VERDICT_SCORE: Record<string, number> = { correct: 100, acceptable: 60, wrong: 0 };

export const nodeById = (s: SimScenario, id: string) => s.nodes.find(n => n.id === id) ?? null;

export function startNodeFor(s: SimScenario, role: string) {
    return s.roles.find(r => r.key === role)?.startNodeId || s.startNodeId;
}

// What the student sees of a node: no verdicts, no explanations, no next ids
export const publicNode = (n: SimNode | null) => n && ({
    id: n.id,
    stage: n.stage,
    speaker: n.speaker,
    text: n.text,
    choices: n.choices.map(c => ({ id: c.id, text: c.text })),
    needsJustification: Boolean(n.freeTextRubric),
    final: !n.choices.length,
    outcome: n.choices.length ? '' : n.outcome
});

// Problems an author must fix before publishing: dangling links, unreachable nodes, dead ends without an outcome
export function validateScenario(s: SimScenario) {
    const problems: string[] = [];
    const ids = new Set<string>();
    for (const n of s.nodes) {
        if (ids.has(n.id)) problems.push(`Node id "${n.id}" is used twice`);
        ids.add(n.id);
    }
    if (!ids.has(s.startNodeId)) problems.push(`Start node "${s.startNodeId}" does not exist`);
    for (const r of s.roles) if (r.startNodeId && !ids.has(r.startNodeId)) problems.push(`Role "${r.key}" starts at a missing node "${r.startNodeId}"`);
    for (const n of s.nodes) {
        const choiceIds = new Set<string>();
        for (const c of n.choices) {
            if (choiceIds.has(c.id)) problems.push(`Node "${n.id}": choice id "${c.id}" is used twice`);
            choiceIds.add(c.id);
            // Every choice leads somewhere; the hearing ends at a node without choices, which holds the outcome
            if (!c.next) problems.push(`Node "${n.id}", choice "${c.id}": choose the next node`);
            else if (!ids.has(c.next)) problems.push(`Node "${n.id}", choice "${c.id}": next node "${c.next}" does not exist`);
        }
        if (!n.choices.length && !n.outcome) problems.push(`Final node "${n.id}" needs an outcome`);
    }
    // Reachability from every start node
    const reach = new Set<string>();
    const stack = [s.startNodeId, ...s.roles.map(r => r.startNodeId).filter(Boolean) as string[]];
    while (stack.length) {
        const id = stack.pop()!;
        if (reach.has(id) || !ids.has(id)) continue;
        reach.add(id);
        for (const c of nodeById(s, id)!.choices) if (c.next) stack.push(c.next);
    }
    for (const n of s.nodes) if (!reach.has(n.id)) problems.push(`Node "${n.id}" cannot be reached`);
    // A cycle would let the hearing run forever
    const visiting = new Set<string>();
    const done = new Set<string>();
    const cyclic = (id: string): boolean => {
        if (done.has(id)) return false;
        if (visiting.has(id)) return true;
        visiting.add(id);
        const n = nodeById(s, id);
        const found = Boolean(n && n.choices.some(c => c.next && cyclic(c.next)));
        visiting.delete(id);
        done.add(id);
        return found;
    };
    if (ids.has(s.startNodeId) && cyclic(s.startNodeId)) problems.push('The scenario has a cycle');
    return problems;
}

export interface SimStep { nodeId: string; choiceId: string; justification?: string }

// Score of the path: average verdict of the choices; the outcome is the final node's outcome
export function scorePath(s: SimScenario, history: SimStep[], finalNodeId: string) {
    const steps = history.map((h, index) => {
        const node = nodeById(s, h.nodeId);
        const choice = node?.choices.find(c => c.id === h.choiceId) ?? null;
        return {
            index,
            nodeId: h.nodeId,
            stage: node?.stage ?? '',
            choiceId: h.choiceId,
            choiceText: choice?.text ?? '',
            verdict: choice?.verdict ?? 'wrong',
            explanation: choice?.explanation ?? '',
            normRef: choice?.normRef ?? '',
            keyNode: Boolean(node?.freeTextRubric),
            freeTextRubric: node?.freeTextRubric ?? '',
            justification: h.justification ?? ''
        };
    });
    const score = steps.length ? Math.round(steps.reduce((a, x) => a + (VERDICT_SCORE[x.verdict] ?? 0), 0) / steps.length) : 0;
    const final = nodeById(s, finalNodeId);
    return { kind: 'sim', score, steps, outcome: final?.outcome || '' };
}
