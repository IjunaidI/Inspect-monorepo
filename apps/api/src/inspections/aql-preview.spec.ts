import { BadRequestException } from '@nestjs/common';
import { InspectionsService } from './inspections.service';

describe('InspectionsService.aqlPreview', () => {
  // aqlPreview is pure (no Prisma/audit/mail access) — pass null clients.
  const svc = new InspectionsService(null as never, null as never, null as never);

  it('returns the computed plan for an in-band lot (1000 -> code J, n 80)', () => {
    const out = svc.aqlPreview(1000, {});
    expect(out.sampleSizeCodeLetter).toBe('J');
    expect(out.sampleSize).toBe(80);
    expect(out.perClass.major).toEqual({ aql: 2.5, ac: 5, re: 6 });
    expect(out.perClass.minor).toEqual({ aql: 4, ac: 7, re: 8 });
    expect(out.perClass.critical).toEqual({ aql: 0, ac: 0, re: 1 });
  });

  it('throws BadRequestException for an AQL outside the verified band', () => {
    expect(() => svc.aqlPreview(1000, { major: 3 })).toThrow(BadRequestException);
  });

  it('throws BadRequestException for a lot size below 2', () => {
    expect(() => svc.aqlPreview(1, {})).toThrow(BadRequestException);
  });
});
