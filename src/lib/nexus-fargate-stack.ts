import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as efs from '@aws-cdk/aws-efs';

export class NexusFargateStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'VPC', {
      cidr: "10.0.0.0/16",
      natGateways: 1,
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC
        },
        {
          cidrMask: 24,
          name: 'container',
          subnetType: ec2.SubnetType.PRIVATE
        },
        {
          cidrMask: 24,
          name: 'persistent',
          subnetType: ec2.SubnetType.ISOLATED
        }
      ]
    });

    const lbsg80 = new ec2.SecurityGroup(this, 'AlbSecurityGroup', { vpc });
    const nexusServiceSg = new ec2.SecurityGroup(this, 'NexusServiceSecurityGroup', { vpc });
    const efsSg = new ec2.SecurityGroup(this, 'EfsSecurityGroup', { vpc });

    // Explicitly allow Port 2049 for NFS/EFS. CDK is capable of automatically inferring other ingress rules
    efsSg.connections.allowFrom(nexusServiceSg, ec2.Port.tcp(2049));

    const fileSystem = new efs.FileSystem(this, 'EFS', {
      vpc: vpc,
      encrypted: true,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      securityGroup: efsSg,
      vpcSubnets: {
        subnets: vpc.selectSubnets({subnetGroupName: 'persistent'}).subnets
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Map Nexus user (uid 200) to root (uid 0), so that Nexus can write to EFS
    const accessPoint = new efs.AccessPoint(this, 'AccessPoint', {
      fileSystem: fileSystem,
      path: '/',
      posixUser: {
        gid: '0',
        uid: '0'
      }
    });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      enableFargateCapacityProviders: true
    });

    // Note: any less memory might make Nexus go boom (container killed due to memory usage)
    const nexusTaskDefinition = new ecs.FargateTaskDefinition(this, 'NexusTaskDef', {
      memoryLimitMiB: 2048,
      cpu: 1024
    });

    nexusTaskDefinition.addVolume({
      name: 'nexus-data-volume',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId
        }
      }
    });

    const nexusContainerDefinition = new ecs.ContainerDefinition(this, 'NexusContainerDef', {
      image: ecs.ContainerImage.fromRegistry('sonatype/nexus3:3.33.1'),
      taskDefinition: nexusTaskDefinition,
      portMappings: [{
        containerPort: 8081,
        hostPort: 8081
      }],
      containerName: 'nexus',
      // Enable init process as best practice of using the execute-command feature
      linuxParameters: new ecs.LinuxParameters(this, 'lpm', {initProcessEnabled: true}),
    });

    nexusContainerDefinition.addMountPoints({
      containerPath: '/nexus-data',
      readOnly: false,
      sourceVolume: 'nexus-data-volume'
    });

    // Add ulimit for file descriptor so Nexus does not complain
    nexusContainerDefinition.addUlimits({
      hardLimit: 65536,
      softLimit: 65536,
      name: ecs.UlimitName.NOFILE
    });

    const nexusService = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: nexusTaskDefinition,
      desiredCount: 1,
      enableExecuteCommand: true,
      minHealthyPercent: 100,
      platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
      securityGroups: [nexusServiceSg],
      vpcSubnets: {
        subnets: vpc.selectSubnets({subnetGroupName: 'container'}).subnets
      }
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
      securityGroup: lbsg80
    });

    const httpListener = alb.addListener('HttpListener', {
      port: 80,
      open: true
    });

    const targetGroup = httpListener.addTargets('NexusTargetGroup', {
      deregistrationDelay: cdk.Duration.seconds(30),
      port: 80,
      healthCheck: {
        path: '/',
        interval: cdk.Duration.seconds(30),
        unhealthyThresholdCount: 10
      },
      targets: [nexusService.loadBalancerTarget({
        containerName: 'nexus',
        containerPort: 8081
      })]
    });

    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName
    })

  }
}
