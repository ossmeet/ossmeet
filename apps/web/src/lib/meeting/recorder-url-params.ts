export function parseRecorderHashParams(hashValue: string): URLSearchParams {
  const hash = hashValue.startsWith("#") ? hashValue.slice(1) : hashValue;
  const questionIndex = hash.indexOf("?");
  const normalized =
    questionIndex === -1
      ? hash
      : `${hash.slice(0, questionIndex)}&${hash.slice(questionIndex + 1)}`;
  return new URLSearchParams(normalized);
}
