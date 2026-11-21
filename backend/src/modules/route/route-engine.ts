// Deterministic check of the route in "where to apply" (PRD 4.5, 5.2): the AI cannot change this score.
// Optimal route = 100, acceptable = 70, each skipped mandatory pre-trial step costs 30,
// a step order different from the route costs 15, a body outside the route = 0 for that route.

export interface RouteStep { bodyCode: string; pretrial?: boolean }
export interface AcceptableRoute { score: number; steps: RouteStep[] }

const PRETRIAL_PENALTY = 30;
const ORDER_PENALTY = 15;

export function compareRoute(route: AcceptableRoute, student: string[]) {
    const codes = route.steps.map(s => s.bodyCode);
    const wrongBodies = student.filter(c => !codes.includes(c));
    const missing = route.steps.filter(s => !student.includes(s.bodyCode));
    const missingPretrial = missing.filter(s => s.pretrial).map(s => s.bodyCode);
    const missingMain = missing.filter(s => !s.pretrial).map(s => s.bodyCode);
    // An incompetent body or a skipped main step means the student went another way
    if (wrongBodies.length || missingMain.length) return { score: 0, exact: false, wrongBodies, missingPretrial, missingMain, orderOk: false };
    const present = codes.filter(c => student.includes(c));
    const orderOk = present.join('|') === [...new Set(student)].join('|');
    const exact = orderOk && !missingPretrial.length && student.length === codes.length;
    const score = Math.max(0, route.score - PRETRIAL_PENALTY * missingPretrial.length - (orderOk ? 0 : ORDER_PENALTY));
    return { score, exact, wrongBodies, missingPretrial, missingMain, orderOk };
}

export function checkRoute(routes: AcceptableRoute[], student: string[]) {
    if (!routes.length) return null;
    let best = { index: -1, ...compareRoute({ score: 0, steps: [] }, student), score: -1 };
    routes.forEach((r, index) => {
        const c = compareRoute(r, student);
        if (c.score > best.score) best = { index, ...c };
    });
    const matched = best.score > 0 ? routes[best.index] : null;
    // Bodies the student named that occur in no accepted route at all
    const allCodes = new Set(routes.flatMap(r => r.steps.map(s => s.bodyCode)));
    return {
        kind: 'route',
        score: Math.max(0, best.score),
        routeIndex: best.score > 0 ? best.index : null,
        optimal: Boolean(matched && matched.score === 100 && best.exact),
        missingPretrial: best.score > 0 ? best.missingPretrial : [],
        orderOk: best.score > 0 ? best.orderOk : false,
        wrongBodies: student.filter(c => !allCodes.has(c))
    };
}
