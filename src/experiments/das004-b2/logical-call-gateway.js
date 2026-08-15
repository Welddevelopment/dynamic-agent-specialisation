export class LogicalCallGateway {
  constructor(gateway) {
    this.gateway = gateway;
    this.budget = gateway.budget;
    this.logicalCalls = 0;
  }
  projectCost(request) { return this.gateway.projectCost(request); }
  async generate(request) {
    this.logicalCalls += 1;
    return this.gateway.generate(request);
  }
}
