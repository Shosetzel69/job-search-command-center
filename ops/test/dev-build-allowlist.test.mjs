import assert from 'node:assert/strict';
import test from 'node:test';
import {admitDevRequest} from '../observation/dev-runtime-observer.mjs';
test('only previously approved build identifiers are readable',()=>{
 assert.equal(admitDevRequest({
  environment:'dev',task:'describe_dev_build',
  buildId:'c5bbfb85-0aab-40c7-aa47-a5589aa9e295',
 }).task,'describe_dev_build');
 assert.throws(()=>admitDevRequest({
  environment:'dev',task:'describe_dev_build',
  buildId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
 }),/resource_denied/);
});
