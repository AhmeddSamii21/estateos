export type PaymentCalculatorLanguage = 'en' | 'ar'
export type InstallmentFrequency = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL'
export type RateMode = 'AMORTIZED' | 'FLAT'

export interface BalloonInput {
  month: number
  amount?: string | number | null
  percent?: string | number | null
}

export interface PaymentPlanInput {
  price: string | number
  downPaymentPercent?: string | number | null
  downPaymentAmount?: string | number | null
  termYears?: string | number | null
  termMonths?: string | number | null
  annualRatePercent?: string | number | null
  rateMode?: RateMode | null
  frequency?: InstallmentFrequency | null
  firstDueDate: string
  balloons?: BalloonInput[] | null
  currency?: string | null
  language?: PaymentCalculatorLanguage | null
}

export interface AmortizationRow {
  period: number
  month: number
  dueAt: string
  payment: string
  principal: string
  interest: string
  balloon: string
  balance: string
}

export interface PaymentPlan {
  price: string
  downPayment: string
  financedAmount: string
  currency: string
  language: PaymentCalculatorLanguage
  termMonths: number
  periodCount: number
  frequency: InstallmentFrequency
  monthStep: number
  firstDueDate: string
  rateMode: RateMode
  annualRatePercent: number
  periodicRatePercent: number
  periodicPayment: string
  totalInterest: string
  totalBalloons: string
  totalPaid: string
  remainingBalance: string
  balloons: Array<{ month: number; amount: string }>
  rows: AmortizationRow[]
}

export const INSTALLMENT_FREQUENCIES: readonly InstallmentFrequency[]
export const INSTALLMENT_MONTH_STEPS: Record<InstallmentFrequency, number>

export function addMonthsClamped(date: Date, months: number): Date
export function calculatePaymentPlan(input: PaymentPlanInput): PaymentPlan
export function formatAmortizationMoney(
  amount: string | number | null | undefined,
  currency?: string | null,
  language?: PaymentCalculatorLanguage
): string
export function formatAmortizationPercent(value: string | number | null | undefined, language?: PaymentCalculatorLanguage): string
export function formatAmortizationDate(isoDate: string | null | undefined, language?: PaymentCalculatorLanguage): string
export function buildAmortizationSummaryText(
  plan: PaymentPlan,
  language?: PaymentCalculatorLanguage,
  currency?: string | null
): string
export function buildAmortizationWhatsAppMessage(
  plan: PaymentPlan,
  language?: PaymentCalculatorLanguage,
  currency?: string | null
): string
