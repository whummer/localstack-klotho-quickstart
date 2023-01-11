# LocalStack Klotho Quickstart

This repo contains a simple quickstart sample to demonstrate how Klotho apps can easily be deployed locally on LocalStack.

We'll use the [Klotho JS demo app](https://github.com/klothoplatform/sample-apps/tree/main/js-my-first-app) and deploy it locally as an AWS cloud application on LocalStack - without ever talking to the real cloud!

## Prerequisites

* LocalStack (Pro version)
* Klotho
* Pulumi & `pulumilocal`
* Node v16+

## Compiling & Installing

The repo already comes with the Klotho demo app (simple pets management API) pre-configured.

Run the following command to compile the Klotho app into deployable assets:
```
$ klotho --app test --provider aws .
```

You'll notice that a `compiled` directory has been created, which contains the assets, as well as a Pulumi config:
```
$ ls compiled/
Pulumi.test.yaml deploylib.ts     index.ts         main             resources.json   test.png
Pulumi.yaml      iac              klotho.yaml      package.json     test.json        tsconfig.json
```

Next, we need to apply a small patch in the sample app to make it work smoothly against LocalStack. Note: this step will become obsolete in the future, as we're planning to create a more seamless integration between Klotho and LocalStack!
```
$ cp patches/* compiled/main/klotho_runtime/
```

We can now change into the `compiled` directory, and install the dependencies:
```
$ cd compiled
$ npm install
```

## Deploying

First, make sure that you have a LocalStack instance running (using the `latest` Docker image) - e.g., using the `localstack` CLI:
```
$ localstack start
```

We can now use the `pulumilocal` CLI from within the `compiled` folder to deploy the app locally:
```
$ pulumilocal up
```

The output will look something like the following:
```
Do you want to perform this update? yes
Updating (localstack):
     Type                             Name                   Status              Info
 +   pulumi:pulumi:Stack              test-localstack        creating (264s).
 +   ├─ awsx:ecr:Repository           test                   created (0.15s)     Building image './main'...
 +   │  └─ aws:ecr:LifecyclePolicy    test                   created (0.09s)
 +   ├─ aws:ecr:Repository            test                   created (1s)
 +   ├─ aws:cloudwatch:LogGroup       main-function-api-lg   created (1s)
 +   ├─ aws:apigateway:RestApi        pet-api                created (1s)
 +   │  └─ aws:apigateway:Resource    pet-apipets/           created (0.03s)
 +   │     ├─ aws:apigateway:Method   GET-pets-45aa7         created (0.06s)
 +   │     └─ aws:apigateway:Method   POST-pets-45aa7        created (0.07s)
 +   ├─ aws:dynamodb:Table            KV_test                created (2s)
 +   ├─ aws:iam:Role                  test_0d6e4_LambdaExec  created (1s)
 +   ├─ aws:s3:Bucket                                        created (1s)
 +   └─ aws:iam:RolePolicyAttachment  test-main-lambdabasic  created (0.04s)

...

 Outputs:
    apiUrls         : [
        [0]: "http://p94ew35tca.execute-api.localhost.localstack.cloud:4566/stage"
    ]

Resources:
    + 22 created

Duration: 20s
 ```

## Running

Once the app is deploy, we can interact with it using `curl` commands (make sure to replace `p94ew35tca` with the actual API Gateway API ID reported in the Pulumi output above):
```
$ curl -d '{"pet":"Meow","owner":"Bob"}' -H "Content-Type: application/json" http://p94ew35tca.execute-api.localhost.localstack.cloud:4566/stage/pets
Added Meow as Bob's pet

$ curl http://p94ew35tca.execute-api.localhost.localstack.cloud:4566/stage/pets
{"Bob":"Meow"}
```

## License

This code is available under the Apache 2.0 license.
