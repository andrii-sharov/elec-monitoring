import { expect, test } from 'vitest';
import { parseCommand } from './commands.ts';

test.each([
  ['/start abc', { name: 'start', arg: 'abc' }],
  ['/start@TestBot abc', { name: 'start', arg: 'abc' }],
  ['/START@testbot abc', { name: 'start', arg: 'abc' }],
  ['/stop', { name: 'stop', arg: null }],
  ['/status@TestBot', { name: 'status', arg: null }],
  ['/start   spaced  ', { name: 'start', arg: 'spaced' }],
])('parses %s', (text, expected) => {
  expect(parseCommand(text, 'TestBot')).toEqual(expected);
});

test.each(['/status@OtherBot', 'hello', '', 'start abc', '/'])('ignores %s', (text) => {
  expect(parseCommand(text, 'TestBot')).toBeNull();
});
