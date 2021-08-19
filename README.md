# nexus-fargate

This project uses CDK to build Fargate infrastructure to host Nexus, and uses EFS for persistent storage (`/nexus-data` specifically). It does not have an S3 bucket for the blob storage but should be simple to configure one.

#### Deploy

The CDK project is located under `/src`. If CDK and the dependencies are installed already, should be able to just deploy with `cdk deploy`.

Check the [prerequisites](https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html#getting_started_prerequisites) if you haven't setup CDK. Use command such as `npm install '@aws-cdk/aws-ec2'` to install missing packages.

You will also need the [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) for ECS execute command feature.

#### Get the initial admin password

We need to use the command below to retrieve the initial randomly generated admin password from the container:
`aws ecs execute-command --cluster CLUSTER_NAME --task TASK_ID --command "cat /nexus-data/admin.password" --interactive`

The output should be something like this:
```
The Session Manager plugin was installed successfully. Use the AWS CLI to start a session.


Starting session with SessionId: ecs-execute-command-035a61aaae01f75a5
042f61a5-cc50-4923-9355-4a5a3287f97b

Exiting session with sessionId: ecs-execute-command-035a61aaae01f75a5.
```

Here, `042f61a5-cc50-4923-9355-4a5a3287f97b` is the initial admin password.

If `execute-command` does not work, you can use the [Amazon ECS Exec Checker](https://github.com/aws-containers/amazon-ecs-exec-checker).

Once you've got the admin password and changed it after the first login, you can change the property `enableExecuteCommand` to false, if you don't want to open the execute command feature.

#### Hardcode warning
This is just a demonstration project, quite a few things are hardcoded for the author's convenience ;)

It also does not have HTTPS or loggings configured, which you should have in a production environment!