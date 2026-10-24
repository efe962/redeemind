export function requestPassword(
  label: string,
  confirmationLabel?: string,
  validate?: (password: string) => Promise<void>,
  invalidMessage = 'Incorrect master password',
  mismatchMessage = 'Passwords do not match',
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.style.width = 'min(400px, calc(100vw - 32px))';
    dialog.style.maxWidth = 'calc(100vw - 32px)';
    dialog.style.boxSizing = 'border-box';
    dialog.style.padding = '20px';
    dialog.style.zIndex = '2147483647';
    const form = document.createElement('form');
    form.method = 'dialog';
    const password = document.createElement('input');
    password.type = 'password';
    password.required = true;
    password.autocomplete = confirmationLabel ? 'new-password' : 'current-password';
    password.setAttribute('aria-label', label);
    const passwordLabel = document.createElement('label');
    passwordLabel.append(label, password);
    form.append(passwordLabel);
    let confirmation: HTMLInputElement | undefined;
    if (confirmationLabel) {
      confirmation = document.createElement('input');
      confirmation.type = 'password';
      confirmation.required = true;
      confirmation.autocomplete = 'new-password';
      confirmation.setAttribute('aria-label', confirmationLabel);
      const confirmationField = document.createElement('label');
      confirmationField.append(confirmationLabel, confirmation);
      form.append(confirmationField);
    }
    const actions = document.createElement('div');
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'OK';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    actions.append(submit, cancel);
    form.append(actions);
    const error = document.createElement('output');
    error.setAttribute('role', 'alert');
    error.style.display = 'block';
    error.style.marginTop = '12px';
    error.style.color = '#b91c1c';
    form.append(error);
    dialog.append(form);
    document.body.append(dialog);
    const close = (value: string | undefined) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener('click', () => close(undefined));
    dialog.addEventListener('cancel', () => close(undefined), { once: true });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (confirmation && confirmation.value !== password.value) {
        error.textContent = mismatchMessage;
        confirmation.focus();
        confirmation.select();
        return;
      }
      submit.disabled = true;
      error.textContent = '';
      try {
        await validate?.(password.value);
        close(password.value);
      } catch {
        error.textContent = invalidMessage;
        password.focus();
        password.select();
        submit.disabled = false;
      }
    });
    dialog.showModal();
    password.focus();
  });
}
