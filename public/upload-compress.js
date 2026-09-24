(() => {
  const MAX_WIDTH = 1600;
  const MAX_HEIGHT = 1600;
  const MAX_TOTAL_BYTES = 3 * 1024 * 1024;
  const JPEG_QUALITY = 0.78;

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('이미지를 읽을 수 없습니다.'));
      };
      image.src = objectUrl;
    });
  }

  async function compressImage(file) {
    if (!file.type.startsWith('image/')) return file;

    const image = await loadImage(file);
    const scale = Math.min(1, MAX_WIDTH / image.naturalWidth, MAX_HEIGHT / image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('이미지 압축에 실패했습니다.');

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('form[enctype="multipart/form-data"] input[type="file"][name="img1"]').forEach((input) => {
      const form = input.form;
      if (!form) return;

      form.addEventListener('submit', async (event) => {
        if (form.dataset.compressing === 'true') return;
        event.preventDefault();
        form.dataset.compressing = 'true';

        const submitButton = form.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;

        try {
          const files = Array.from(input.files || []);
          const compressedFiles = await Promise.all(files.map(compressImage));
          const totalBytes = compressedFiles.reduce((total, file) => total + file.size, 0);

          if (totalBytes > MAX_TOTAL_BYTES) {
            throw new Error('사진을 조금 줄이거나 나누어 등록해주세요. 한 번에 최대 3MB까지 등록할 수 있습니다.');
          }

          const transfer = new DataTransfer();
          compressedFiles.forEach((file) => transfer.items.add(file));
          input.files = transfer.files;
          form.submit();
        } catch (error) {
          alert(error.message || '사진 업로드를 준비하지 못했습니다.');
          form.dataset.compressing = 'false';
          if (submitButton) submitButton.disabled = false;
        }
      });
    });
  });
})();
