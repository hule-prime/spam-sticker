from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
output = root / "dist" / "kuku-sticker-x3.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for source in sorted((root / "extension").iterdir()):
        if source.is_file() and not source.name.startswith("."):
            archive.write(source, source.name)
    archive.write(root / "README.md", "README.md")
print(output)
