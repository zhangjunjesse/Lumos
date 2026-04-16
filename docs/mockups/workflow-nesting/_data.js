// 共享数据：电商一键出商品图 DSL (19 steps)
window.WORKFLOW_DATA = {
  name: '电商一键出商品图',
  steps: [
    { id: 'filter-refs', type: 'agent', preset: '商品图分析师' },
    { id: 'identify-brief', type: 'agent', preset: '商品图分析师', dependsOn: ['filter-refs'] },
    { id: 'cutout-loop', type: 'while', mode: 'do-while', dependsOn: ['filter-refs'],
      condition: 'state.qcPass != true', maxIterations: 2,
      body: ['do-cutout', 'cutout-qc'] },
    { id: 'do-cutout', type: 'agent', preset: '商品抠图师' },
    { id: 'cutout-qc', type: 'agent', preset: '商品图分析师' },
    { id: 'check-cutout-success', type: 'if-else', dependsOn: ['cutout-loop', 'identify-brief'],
      condition: 'cutout-loop.state.qcPass == true',
      then: ['plan-directions', 'scene-refine-loop', 'check-final-result'],
      else: ['cutout-failed-fallback'] },
    { id: 'plan-directions', type: 'agent', preset: '场景方向策划师' },
    { id: 'scene-refine-loop', type: 'while', mode: 'do-while',
      dependsOn: ['plan-directions', 'cutout-loop', 'identify-brief'],
      condition: 'state.finalPass != true AND state.sceneAttempts < 3', maxIterations: 3,
      body: ['generate-scenes', 'score-scenes', 'refine-subloop', 'collect-iteration-state'] },
    { id: 'generate-scenes', type: 'agent', preset: '场景生成师' },
    { id: 'score-scenes', type: 'agent', preset: '商品图分析师' },
    { id: 'refine-subloop', type: 'while', mode: 'do-while',
      dependsOn: ['generate-scenes', 'score-scenes', 'cutout-loop', 'identify-brief'],
      condition: 'state.needsRefine == "final_refine" AND state.qcPass != true', maxIterations: 2,
      body: ['do-refine', 'final-qc', 'eval-refine-qc'] },
    { id: 'do-refine', type: 'agent', preset: '终版精修师' },
    { id: 'final-qc', type: 'agent', preset: '商品图分析师' },
    { id: 'eval-refine-qc', type: 'agent', preset: '商品图分析师' },
    { id: 'collect-iteration-state', type: 'agent', preset: '商品图分析师' },
    { id: 'check-final-result', type: 'if-else', dependsOn: ['scene-refine-loop'],
      condition: 'scene-refine-loop.state.finalPass == true',
      then: ['output-success'], else: ['output-fallback'] },
    { id: 'output-success', type: 'agent', preset: '商品图分析师' },
    { id: 'output-fallback', type: 'agent', preset: '终版精修师' },
    { id: 'cutout-failed-fallback', type: 'agent', preset: '商品图分析师' },
  ],
};

// 通用工具
window.WFUtil = (function() {
  const CONTAINERS = new Set(['while', 'for-each', 'if-else']);
  const stepById = {};
  window.WORKFLOW_DATA.steps.forEach(s => stepById[s.id] = s);

  function getBodyIds(step) {
    return [...(step.body || []), ...(step.then || []), ...(step.else || [])];
  }
  function isContainer(step) { return CONTAINERS.has(step.type); }
  function allBodyIds() {
    const ids = new Set();
    window.WORKFLOW_DATA.steps.forEach(s => getBodyIds(s).forEach(id => ids.add(id)));
    return ids;
  }
  function topLevel() {
    const owned = allBodyIds();
    return window.WORKFLOW_DATA.steps.filter(s => !owned.has(s.id));
  }
  // Kahn topo sort limited to given step subset
  function buildLayers(steps) {
    const ids = new Set(steps.map(s => s.id));
    const indeg = new Map(steps.map(s => [s.id, (s.dependsOn || []).filter(d => ids.has(d)).length]));
    const out = new Map(steps.map(s => [s.id, []]));
    steps.forEach(s => (s.dependsOn || []).forEach(d => {
      if (ids.has(d)) out.get(d).push(s.id);
    }));
    const layers = [];
    const remaining = new Set(ids);
    while (remaining.size) {
      const ready = [...remaining].filter(id => (indeg.get(id) || 0) === 0);
      if (!ready.length) { layers.push([...remaining].map(id => stepById[id])); break; }
      layers.push(ready.map(id => stepById[id]));
      ready.forEach(id => {
        remaining.delete(id);
        out.get(id).forEach(n => indeg.set(n, indeg.get(n) - 1));
      });
    }
    return layers;
  }

  const TYPE_STYLE = {
    agent:      { badge: 'agent',    color: '#8b5cf6', bg: 'rgba(139,92,246,0.10)', border: 'rgba(139,92,246,0.30)' },
    'if-else':  { badge: 'if/else',  color: '#d97706', bg: 'rgba(217,119,6,0.10)',  border: 'rgba(217,119,6,0.35)' },
    'for-each': { badge: 'for-each', color: '#059669', bg: 'rgba(5,150,105,0.10)',  border: 'rgba(5,150,105,0.35)' },
    while:      { badge: 'while',    color: '#0284c7', bg: 'rgba(2,132,199,0.10)',  border: 'rgba(2,132,199,0.35)' },
  };
  function getStyle(type) { return TYPE_STYLE[type] || TYPE_STYLE.agent; }
  function getLabel(step) {
    if (step.type === 'agent') return step.preset || step.id;
    if (step.type === 'if-else') return 'IF / ELSE';
    if (step.type === 'while') return (step.mode === 'do-while') ? 'DO-WHILE' : 'WHILE';
    if (step.type === 'for-each') return 'FOR EACH';
    return step.id;
  }
  function containerDetail(step) {
    if (step.type === 'while') return `max:${step.maxIterations || 20} · ${step.condition || ''}`;
    if (step.type === 'if-else') return step.condition || '';
    if (step.type === 'for-each') return `in ${step.collection || '?'}`;
    return '';
  }

  return { CONTAINERS, stepById, getBodyIds, isContainer, allBodyIds, topLevel, buildLayers, getStyle, getLabel, containerDetail };
})();
