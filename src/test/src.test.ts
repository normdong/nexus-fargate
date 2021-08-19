import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as NexusFargate from '../lib/nexus-fargate-stack';

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new NexusFargate.NexusFargateStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
