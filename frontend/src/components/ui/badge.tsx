import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold transition-colors border',
  {
    variants: {
      variant: {
        default:     'border-transparent bg-primary text-primary-foreground',
        secondary:   'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline:     'border-border text-foreground',
        green:       'border-green-200   bg-green-50   text-green-700',
        red:         'border-red-200     bg-red-50     text-red-700',
        blue:        'border-blue-200    bg-blue-50    text-blue-700',
        purple:      'border-purple-200  bg-purple-50  text-purple-700',
        orange:      'border-orange-200  bg-orange-50  text-orange-700',
        slate:       'border-slate-200   bg-slate-100  text-slate-600',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
