const status = document.querySelector("#copy-status");

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("浏览器拒绝复制。");
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy]");
  if (!button) return;
  const box = document.getElementById(button.dataset.copy);
  const text = box?.querySelector("code")?.textContent.trim();
  if (!text) return;

  const original = button.textContent;
  button.disabled = true;
  try {
    await copyText(text);
    button.textContent = "已复制";
    status.textContent = "内容已复制到剪贴板。";
  } catch (error) {
    button.textContent = "复制失败";
    status.textContent = `${error.message} 请手动选择文本复制。`;
  } finally {
    window.setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1200);
  }
});
