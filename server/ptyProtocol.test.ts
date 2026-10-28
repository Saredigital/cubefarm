import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { encode, hostSocket, readMessages, type ToHost } from './ptyProtocol.ts';

describe('hostSocket', () => {
  it('names one named pipe per office home on Windows, whatever the path looks like', () => {
    const a = hostSocket('C:\\Users\\Ada\\.sareoffice', 'win32');
    expect(a).toMatch(/^\\\\\.\\pipe\\sareoffice-pty-[0-9a-f]{12}$/);
    expect(hostSocket('c:\\users\\ada\\.sareoffice', 'win32')).toBe(a);
    expect(hostSocket('C:\\Users\\Ada\\other-home', 'win32')).not.toBe(a);
  });

  it('puts the socket in the office home elsewhere', () => {
    expect(hostSocket('/home/ada/.sareoffice', 'linux')).toBe(path.join('/home/ada/.sareoffice', 'pty.sock'));
  });
});

describe('readMessages', () => {
  it('reads one message per line, across chunks, skipping lines that are not JSON', () => {
    const sock = Object.assign(new EventEmitter(), { setEncoding: () => undefined }) as unknown as Socket;
    const got: ToHost[] = [];
    readMessages<ToHost>(sock, (m) => got.push(m));
    const a = encode({ op: 'write', id: 'x', data: 'line one\nline two' });
    sock.emit('data', a.slice(0, 10));
    sock.emit('data', `${a.slice(10)}not json\n${encode({ op: 'kill', id: 'x' })}`);
    expect(got).toEqual([
      { op: 'write', id: 'x', data: 'line one\nline two' },
      { op: 'kill', id: 'x' },
    ]);
  });
});
