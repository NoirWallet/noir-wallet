import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion'
import { Card as FumadocsCard, Cards } from 'fumadocs-ui/components/card'
import { Step, Steps } from 'fumadocs-ui/components/steps'
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'
import { createElement, type ComponentProps } from 'react'
import {
  ArrowDownToLine,
  ArrowLeftRight,
  Blocks,
  Braces,
  Chrome,
  Code2,
  Download,
  History,
  Landmark,
  LockKeyhole,
  Package,
  Send,
  ShieldCheck,
  Users,
  type LucideIcon
} from 'lucide-react'

const cardIcons: Record<string, LucideIcon> = {
  ArrowDownToLine,
  ArrowLeftRight,
  Blocks,
  Braces,
  Chrome,
  Code2,
  Download,
  History,
  Landmark,
  LockKeyhole,
  Package,
  Send,
  ShieldCheck,
  Users
}

function Card({ icon, ...props }: ComponentProps<typeof FumadocsCard>) {
  const resolvedIcon =
    typeof icon === 'string' && icon in cardIcons ? createElement(cardIcons[icon]) : icon

  return <FumadocsCard icon={resolvedIcon} {...props} />
}

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Accordion,
    Accordions,
    Card,
    Cards,
    Step,
    Steps,
    Tab,
    Tabs,
    ...components
  }
}

export const useMDXComponents = getMDXComponents

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}
