/**
 * Capability 归一化验证脚本
 *
 * 不依赖 vitest：直接用 Node 18+ 跑。
 *
 *   node lib/capability.test.mjs
 */

// === 被测代码最小副本（避免引入 expo-constants）===
const CAPABILITY_IDS = {
  ai_tutor_chat: 'chat',
  deep_solve: 'deep_solve',
  deep_question: 'deep_question',
  deep_research: 'deep_research',
  course_generate: 'course_generate',
  problem_video_generate: 'problem_video_generate',
  math_animator: 'math_animator',
  visualize: 'visualize',
  co_writer: 'co_writer',
  quiz_practice: 'quiz_practice',
  interactive_demo: 'interactive_demo',
};

function normalizeCapability(raw) {
  return raw || CAPABILITY_IDS.ai_tutor_chat;
}

// === 极简断言 ===
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${e.message}`);
    failed++;
  }
}

function assertEq(actual, expected, label = '') {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
  }
}

console.log('Capability 归一化');

test('null / undefined / "" 落到 chat 默认值', () => {
  assertEq(normalizeCapability(null), 'chat');
  assertEq(normalizeCapability(undefined), 'chat');
  assertEq(normalizeCapability(''), 'chat');
});

test('6 个 UI 功能 id 直接透传', () => {
  assertEq(normalizeCapability('chat'), 'chat');
  assertEq(normalizeCapability('deep_solve'), 'deep_solve');
  assertEq(normalizeCapability('deep_question'), 'deep_question');
  assertEq(normalizeCapability('deep_research'), 'deep_research');
  assertEq(normalizeCapability('math_animator'), 'math_animator');
  assertEq(normalizeCapability('visualize'), 'visualize');
});

test('未知字符串原样透传（让 Gateway 决定）', () => {
  assertEq(normalizeCapability('totally-unknown-cap'), 'totally-unknown-cap');
});

console.log(`\n通过 ${passed} / 失败 ${failed}`);
process.exit(failed > 0 ? 1 : 0);
