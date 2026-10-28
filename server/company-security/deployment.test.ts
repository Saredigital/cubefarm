import { describe, expect, it } from 'vitest';
import { assertKeyOutsideState, assertWindowsBrokerDeployment, verifyDeploymentFacts, type DeploymentFacts } from './deployment.ts';

describe('Windows broker deployment facts', () => {
  const target = 'private-key';
  const facts: DeploymentFacts = { userName: 'BROKER\\sareoffice-broker', userSid: 'S-1-5-21-111-222-333-1001',
    sessionId: 0, administrator: false, paths: [{ path: target, protected: true, allowedSids: ['S-1-5-21-111-222-333-1001', 'S-1-5-18'],
      ownerSid: 'S-1-5-18', isReparse: false, unsafeDescendants: false }], codePaths: [], unsafeAncestors: false };
  it('accepts dedicated noninteractive identity with restricted ACL facts', () => {
    expect(() => verifyDeploymentFacts(facts, [target])).not.toThrow();
  });
  it('rejects same-user interactive CLIs, admin identities, broad ACLs and missing paths', () => {
    expect(() => verifyDeploymentFacts({ ...facts, sessionId: 1 }, [target])).toThrow();
    expect(() => verifyDeploymentFacts({ ...facts, administrator: true }, [target])).toThrow();
    expect(() => verifyDeploymentFacts({ ...facts, userName: 'BROKER\\developer' }, [target])).toThrow();
    expect(() => verifyDeploymentFacts({ ...facts, paths: [{ ...facts.paths[0], allowedSids: ['S-1-1-0'] }] }, [target])).toThrow();
    expect(() => verifyDeploymentFacts(facts, ['missing'])).toThrow();
  });
  it('rejects code injection rights, untrusted owners, reparse points and private child ACLs', () => {
    const code = { path: 'runtime', ownerSid: 'S-1-5-32-544', writerSids: ['S-1-5-32-544'], isReparse: false, unsafeDescendants: false };
    expect(() => verifyDeploymentFacts({ ...facts, codePaths: [code] }, [target], ['runtime'])).not.toThrow();
    expect(() => verifyDeploymentFacts({ ...facts, codePaths: [{ ...code, writerSids: ['S-1-5-32-545'] }] }, [target], ['runtime'])).toThrow();
    expect(() => verifyDeploymentFacts({ ...facts, codePaths: [{ ...code, ownerSid: facts.userSid }] }, [target], ['runtime'])).toThrow();
    expect(() => verifyDeploymentFacts({ ...facts, paths: [{ ...facts.paths[0], isReparse: true }] }, [target])).toThrow();
    expect(() => verifyDeploymentFacts({ ...facts, paths: [{ ...facts.paths[0], unsafeDescendants: true }] }, [target])).toThrow();
    expect(() => verifyDeploymentFacts({ ...facts, unsafeAncestors: true }, [target])).toThrow();
  });
  it('actual platform probe cannot start a broker from the interactive development identity', () => {
    expect(() => assertWindowsBrokerDeployment(['nonexistent-private-key'], [process.cwd()])).toThrow();
  });
  it('rejects a key in state across Windows case variants and allows sibling directories', () => {
    expect(() => assertKeyOutsideState('c:\\brokerdata\\KEY', 'C:\\BrokerData', 'win32')).toThrow();
    expect(() => assertKeyOutsideState('C:\\BrokerData', 'c:\\brokerdata', 'win32')).toThrow();
    expect(() => assertKeyOutsideState('C:\\BrokerData2\\key', 'C:\\BrokerData', 'win32')).not.toThrow();
    expect(() => assertKeyOutsideState('D:\\Keys\\key', 'C:\\BrokerData', 'win32')).not.toThrow();
  });
});
