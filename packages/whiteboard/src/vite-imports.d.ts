// Vite ?url imports return a string URL to the asset
declare module "*.mjs?url" {
  const url: string;
  export default url;
}
