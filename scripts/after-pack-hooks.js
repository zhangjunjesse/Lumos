/* eslint-disable @typescript-eslint/no-require-imports */
// electron-builder 只接受一个 afterPack 入口,这里按序聚合各钩子。
// (scripts/after-pack.js 是未接线的历史遗留,别混淆。)
const ensureModels = require('./after-pack-ensure-models');
const ensureAgentSdk = require('./after-pack-ensure-agent-sdk');

module.exports = async function afterPackHooks(context) {
  await ensureModels(context);
  await ensureAgentSdk(context);
};
