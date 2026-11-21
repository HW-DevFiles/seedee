import Image from "next/image";
import Link from "next/link";

export function Brand() {
  return (
    <Link
      href="/"
      aria-label="Seedee home"
      className="inline-flex min-h-11 items-center rounded-lg"
    >
      <Image
        src="/brand/wordmark-light.svg"
        alt="Seedee"
        width={210}
        height={50}
        priority
        className="h-10 w-auto"
      />
    </Link>
  );
}
