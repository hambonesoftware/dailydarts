type SuggestResponse = {
  title?: string;
};

type CreateResponse = {
  navigateTo?: string;
  message?: string;
};

const titleInput = document.querySelector<HTMLInputElement>('#title-input');
const form = document.querySelector<HTMLFormElement>('#post-create-form');
const status = document.querySelector<HTMLParagraphElement>('#status');
const submitButton = document.querySelector<HTMLButtonElement>('#submit-button');

const setStatus = (message: string, isError = false) => {
  if (!status) return;
  status.textContent = message;
  status.dataset.state = isError ? 'error' : 'info';
};

const setBusy = (isBusy: boolean) => {
  if (submitButton) {
    submitButton.disabled = isBusy;
  }
  if (titleInput) {
    titleInput.disabled = isBusy;
  }
};

const fetchSuggestedTitle = async () => {
  try {
    const response = await fetch('/api/post-title/suggest');
    const data = (await response.json()) as SuggestResponse;
    if (titleInput && data.title) {
      titleInput.value = data.title;
      titleInput.focus();
      titleInput.setSelectionRange(data.title.length, data.title.length);
    }
  } catch (error) {
    setStatus('Unable to load a suggested title. You can enter one manually.', true);
  }
};

const submitTitle = async (title: string) => {
  const response = await fetch('/api/post-create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });

  const data = (await response.json()) as CreateResponse;
  if (!response.ok) {
    throw new Error(data.message || 'Failed to create post.');
  }

  if (data.navigateTo) {
    window.location.href = data.navigateTo;
  }
};

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!titleInput) return;

  const title = titleInput.value.trim();
  if (!title) {
    setStatus('Please enter a title before creating the post.', true);
    return;
  }

  setBusy(true);
  setStatus('Creating post…');

  try {
    await submitTitle(title);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create post.';
    setStatus(message, true);
    setBusy(false);
  }
});

void fetchSuggestedTitle();
