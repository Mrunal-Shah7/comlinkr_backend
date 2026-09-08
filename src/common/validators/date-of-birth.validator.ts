import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { computeAge } from '../utils/age';

const MIN_AGE = 18; // SPRINT-57: the Terms of Service prohibit accounts for under-18s
const MAX_AGE = 120;

/**
 * SPRINT-57: rejects dates of birth that are in the future, implausibly old, or under the
 * minimum age the Terms of Service allow. Runs after @IsDateString, so the value is a string.
 */
export function IsRealisticDateOfBirth(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isRealisticDateOfBirth',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          const parsed = new Date(value);
          if (Number.isNaN(parsed.getTime())) return false;
          if (parsed.getTime() > Date.now()) return false;
          const age = computeAge(parsed);
          return age !== null && age >= MIN_AGE && age <= MAX_AGE;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a valid date of birth for someone aged ${MIN_AGE}-${MAX_AGE}`;
        },
      },
    });
  };
}
