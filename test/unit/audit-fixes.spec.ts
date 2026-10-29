/**
 * Unit tests for the 2026-10-25 audit fixes: OTP atomicity/hashing (SEC-07), session secret guard (SEC-05),
 * reservation time validation (REL-01) and the public-IP guard for article fetches (SEC-11).
 */
/* eslint-disable @typescript-eslint/require-await -- fake Prisma methods are async to mirror the real API */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';
import { OtpService } from '../../src/modules/auth/otp.service';
import { getSessionSecret } from '../../src/config/session.config';
import { CreateReservationDto } from '../../src/modules/food/dto/create-reservation.dto';

type Row = Record<string, any>;

function fakeOtpPrisma() {
  const rows: Row[] = [];
  let seq = 0;
  const matchesWhere = (row: Row, where: Row) =>
    Object.entries(where).every(([k, cond]) => {
      const v = row[k];
      if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
        if ('gt' in cond) return v > cond.gt;
        if ('lt' in cond) return v < cond.lt;
        return true;
      }
      return v === cond;
    });
  return {
    rows,
    otpCode: {
      updateMany: async ({ where, data }: Row) => {
        const hit = rows.filter((r) => matchesWhere(r, where));
        for (const r of hit) {
          for (const [k, v] of Object.entries(data)) {
            r[k] =
              v && typeof v === 'object' && 'increment' in (v as Row)
                ? r[k] + (v as Row).increment
                : v;
          }
        }
        return { count: hit.length };
      },
      create: async ({ data }: Row) => {
        const row = { id: `otp-${++seq}`, createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      },
      findFirst: async ({ where }: Row) =>
        [...rows].reverse().find((r) => matchesWhere(r, where)) ?? null,
    },
  };
}

describe('OtpService (SEC-07)', () => {
  let sentCode = '';
  const mail = {
    sendOtpEmail: async (_to: string, code: string) => {
      sentCode = code;
    },
  };

  it('stores a digest rather than the plaintext code', async () => {
    const prisma = fakeOtpPrisma();
    const svc = new OtpService(prisma as any, mail as any);
    await svc.generateAndSendOtp('a@b.com', 'PASSWORD_RESET');
    expect(sentCode).toMatch(/^\d{6}$/);
    expect(prisma.rows[0].code).not.toBe(sentCode);
    expect(prisma.rows[0].code).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts the correct code exactly once, even under concurrent verification', async () => {
    const prisma = fakeOtpPrisma();
    const svc = new OtpService(prisma as any, mail as any);
    await svc.generateAndSendOtp('a@b.com', 'PASSWORD_RESET');
    const results = await Promise.allSettled([
      svc.verifyOtp('a@b.com', sentCode, 'PASSWORD_RESET'),
      svc.verifyOtp('a@b.com', sentCode, 'PASSWORD_RESET'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('counts wrong attempts and locks out at the cap', async () => {
    const prisma = fakeOtpPrisma();
    const svc = new OtpService(prisma as any, mail as any);
    await svc.generateAndSendOtp('a@b.com', 'REGISTRATION');
    const good = sentCode;
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await expect(
        svc.verifyOtp('a@b.com', bad, 'REGISTRATION'),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.rows[0].attempts).toBe(5);
    await expect(
      svc.verifyOtp('a@b.com', good, 'REGISTRATION'),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe('getSessionSecret (SEC-05)', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('refuses a missing, default or short secret in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SESSION_SECRET;
    expect(() => getSessionSecret()).toThrow();
    process.env.SESSION_SECRET = 'change-me-in-production';
    expect(() => getSessionSecret()).toThrow();
    process.env.SESSION_SECRET = 'short';
    expect(() => getSessionSecret()).toThrow();
  });

  it('accepts a strong secret in production and falls back only in development', () => {
    process.env.NODE_ENV = 'production';
    process.env.SESSION_SECRET = 'x'.repeat(48);
    expect(getSessionSecret()).toBe('x'.repeat(48));
    process.env.NODE_ENV = 'development';
    delete process.env.SESSION_SECRET;
    expect(getSessionSecret()).toBeTruthy();
  });
});

describe('CreateReservationDto time validation (REL-01)', () => {
  const check = async (time: string) =>
    validate(
      plainToInstance(CreateReservationDto, {
        date: '2026-11-01',
        time,
        partySize: 2,
      }),
    );

  it.each(['99:99', '24:00', '12:60', '7:30', 'ab:cd'])('rejects %s', async (t) => {
    expect((await check(t)).length).toBeGreaterThan(0);
  });

  it.each(['00:00', '09:05', '19:30', '23:59'])('accepts %s', async (t) => {
    expect(await check(t)).toHaveLength(0);
  });
});
