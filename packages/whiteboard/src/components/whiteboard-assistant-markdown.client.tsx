import ReactMarkdown from "react-markdown"
import type { Components } from "react-markdown"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"

export interface AssistantMarkdownRendererProps {
	content: string
	components: Components
}

export function AssistantMarkdownRenderer({
	content,
	components,
}: AssistantMarkdownRendererProps) {
	return (
		<ReactMarkdown
			remarkPlugins={[remarkMath]}
			rehypePlugins={[rehypeKatex]}
			components={components}
		>
			{content}
		</ReactMarkdown>
	)
}
