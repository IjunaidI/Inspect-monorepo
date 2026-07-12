import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /** Service identifier for the public root route (real health is /health). */
  getServiceInfo(): { service: string; status: string } {
    return { service: 'inspect-api', status: 'ok' };
  }
}
