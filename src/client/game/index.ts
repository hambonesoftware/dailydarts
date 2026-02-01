export async function loadGame() {
  const module = await import("./game");
  return module.mountGame;
}
