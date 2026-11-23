import { Prisma } from '@prisma/client'
import { failValidation } from './validation'

export type MoneyInput = string | number | Prisma.Decimal | { toString(): string }

export interface MonetaryPayment {
  amount: MoneyInput
  baseAmount?: MoneyInput | null
  currency?: string | null
  status?: string | null
  deletedAt?: unknown
}

function decimalOf(value: MoneyInput, field: string, allowNegative = false): Prisma.Decimal {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : value.toString().trim()
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) {
    failValidation(field, `${field} must be a monetary amount with at most 2 decimal places`)
  }
  const amount = new Prisma.Decimal(text)
  if (!allowNegative && amount.isNegative()) failValidation(field, `${field} cannot be negative`)
  return amount
}

export function parseMoney(value: unknown, field: string, options: { required?: boolean; min?: number; allowNegative?: boolean } = {}): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (options.required) failValidation(field, `${field} is required`)
    return undefined
  }
  const amount = decimalOf(value as MoneyInput, field, options.allowNegative === true)
  if (options.min !== undefined && amount.lessThan(options.min)) failValidation(field, `${field} is below the minimum`)
  return amount.toFixed(2)
}

export function parseRate(value: unknown, field = 'exchangeRate'): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const text = String(value).trim()
  if (!/^\d+(?:\.\d{1,8})?$/.test(text)) failValidation(field, `${field} must be a positive rate`)
  const rate = new Prisma.Decimal(text)
  if (rate.lte(0)) failValidation(field, `${field} must be greater than zero`)
  return rate.toFixed(8)
}

export function commissionAmount(dealAmount: MoneyInput, rate: MoneyInput): string {
  const decimalRate = new Prisma.Decimal(rate.toString())
  if (decimalRate.lte(0)) failValidation('rate', 'rate must be greater than zero')
  return new Prisma.Decimal(dealAmount.toString()).times(decimalRate).toDecimalPlaces(2).toFixed(2)
}

export function sumMoney(values: MoneyInput[]): string {
  return values
    .reduce<Prisma.Decimal>((total, value) => total.plus(new Prisma.Decimal(value.toString())), new Prisma.Decimal(0))
    .toFixed(2)
}

export function convertToBase(amount: string, currency: string, baseCurrency: string, rateValue: unknown): { baseAmount: string; exchangeRate: string } {
  const normalized = currency.toUpperCase()
  if (normalized === baseCurrency.toUpperCase()) {
    return { baseAmount: amount, exchangeRate: '1.00000000' }
  }
  const exchangeRate = parseRate(rateValue)
  if (!exchangeRate) failValidation('exchangeRate', 'exchangeRate is required for foreign-currency transactions')
  return {
    baseAmount: new Prisma.Decimal(amount).times(exchangeRate).toDecimalPlaces(2).toFixed(2),
    exchangeRate
  }
}

export function receivedAmount(payments: MonetaryPayment[]): string {
  return sumMoney(
    payments
      .filter((payment) => payment.status === 'COMPLETED' && !payment.deletedAt)
      .map((payment) => payment.baseAmount ?? payment.amount)
  )
}

export function outstandingBalance(dealAmount: MoneyInput, payments: MonetaryPayment[]): string {
  const balance = new Prisma.Decimal(dealAmount.toString()).minus(receivedAmount(payments))
  return (balance.isNegative() ? new Prisma.Decimal(0) : balance).toFixed(2)
}

export function toNumber(value: MoneyInput): number {
  return new Prisma.Decimal(value.toString()).toNumber()
}
