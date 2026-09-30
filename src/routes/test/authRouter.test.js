const request = require("supertest");
const app = require("../../service");

const testUser = {
  name: "pizza diner",
  email: "reg@test.com",
  password: "a",
};

let testUserAuthToken;

beforeAll(async () => {
  testUser.email =
    Math.random().toString(36).substring(2, 12) + "@test.com";

  const registerRes = await request(app)
    .post("/api/auth")
    .send(testUser);

  testUserAuthToken = registerRes.body.token;

  expectValidJwt(testUserAuthToken);
});

test("login", async () => {
  const loginRes = await request(app)
    .put("/api/auth")
    .send(testUser);

  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = {
    ...testUser,
    roles: [{ role: "diner" }],
  };

  delete expectedUser.password;

  expect(loginRes.body.user).toMatchObject(expectedUser);
});

test("rejects registration when required information is missing", async () => {
  const response = await request(app)
    .post("/api/auth")
    .send({
      name: "pizza diner",
      email: "missing-password@test.com",
    });

  expect(response.status).toBe(400);
  expect(response.body.message).toBe(
    "name, email, and password are required"
  );
});

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(
    /^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/
  );
}

test("rejects logout without authentication", async () => {
  const response = await request(app).delete("/api/auth");

  expect(response.status).toBe(401);
  expect(response.body.message).toBe("unauthorized");
});

test("logs out an authenticated user", async () => {
  const response = await request(app)
    .delete("/api/auth")
    .set("Authorization", `Bearer ${testUserAuthToken}`);

  expect(response.status).toBe(200);
  expect(response.body.message).toBe("logout successful");
});

test("gets the authenticated user", async () => {
  // Log in again because the earlier logout test invalidated the old token
  const loginResponse = await request(app)
    .put("/api/auth")
    .send(testUser);

  const response = await request(app)
    .get("/api/user/me")
    .set("Authorization", `Bearer ${loginResponse.body.token}`);

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    id: loginResponse.body.user.id,
    name: testUser.name,
    email: testUser.email,
  });
});