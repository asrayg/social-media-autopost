import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.user.upsert({
    where: { id: "cldefaultuser000" },
    update: {},
    create: {
      id: "cldefaultuser000",
      email: "asraygopa@gmail.com",
      passwordHash: "mvp-no-auth",
    },
  });
  console.log("Seeded default user");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
