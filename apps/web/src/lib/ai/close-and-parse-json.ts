/**
 * Streaming JSON parser. Given a potentially incomplete JSON string,
 * attempt to close unclosed brackets/braces/quotes and parse.
 */
export function closeAndParseJson(string: string) {
	const stackOfOpenings: string[] = []

	let i = 0
	while (i < string.length) {
		const char = string[i]
		const lastOpening = stackOfOpenings.at(-1)

		if (char === '"') {
			if (i > 0 && string[i - 1] === '\\') {
				i++
				continue
			}

			if (lastOpening === '"') {
				stackOfOpenings.pop()
			} else {
				stackOfOpenings.push('"')
			}
		}

		if (lastOpening === '"') {
			i++
			continue
		}

		if (char === '{' || char === '[') {
			stackOfOpenings.push(char)
		}

		if (char === '}' && lastOpening === '{') {
			stackOfOpenings.pop()
		}

		if (char === ']' && lastOpening === '[') {
			stackOfOpenings.pop()
		}

		i++
	}

	for (let j = stackOfOpenings.length - 1; j >= 0; j--) {
		const opening = stackOfOpenings[j]
		if (opening === '{') {
			string += '}'
		}
		if (opening === '[') {
			string += ']'
		}
		if (opening === '"') {
			string += '"'
		}
	}

	try {
		return JSON.parse(string)
	} catch {
		return null
	}
}
