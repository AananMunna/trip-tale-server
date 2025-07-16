const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.9c3fo4b.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.5yis0oo.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

var admin = require("firebase-admin");

// 1. Read base64 string from environment
const serviceAccountJSON = Buffer.from(
  process.env.FIREBASE_SERVICE_KEY,
  "base64"
).toString("utf-8");

// 2. Parse it back to object
const serviceAccount = JSON.parse(serviceAccountJSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const jwt = require("jsonwebtoken");

// Replace with .env in production
const JWT_SECRET = process.env.JWT_SECRET;

app.post("/jwt", async (req, res) => {
  const user = req.body; // { email: "user@gmail.com", role: "tourist" }

  const token = jwt.sign(user, JWT_SECRET, {
    expiresIn: "17d", // token will expire in 7 days
  });

  res.send({ token });
});

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) return res.status(401).send({ message: "Unauthorized" });

  const token = authHeader.split(" ")[1];

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).send({ message: "Forbidden" });

    req.user = decoded;
    next();
  });
}

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// console.log(process.env.STRIPE_SECRET_KEY)
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    const usersCollection = client.db("tripTale").collection("users");
    const packagesCollection = client.db("tripTale").collection("packages");
    const bookingsCollection = client.db("tripTale").collection("bookings");
    const paymentsCollection = client.db("tripTale").collection("payments");
    const storiesCollection = client.db("tripTale").collection("stories");
    const applicationsCollection = client
      .db("tripTale")
      .collection("guideApplications");

    // all post route here--------------------------------------------------------
    // stripe payment intent----------------------------------------------------
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const { amount } = req.body;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount, // in cents: 7200 => 720000
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // add packages api
    app.post("/packages", verifyJWT, async (req, res) => {
      try {
        const {
          title,
          images, // Array of image URLs
          description,
          tourType,
          duration,
          price,
          tourPlan, // Array of strings like "Day 1: ...."
        } = req.body;

        // Basic validation
        if (
          !title ||
          !images ||
          !description ||
          !tourType ||
          !duration ||
          !price ||
          !tourPlan ||
          !Array.isArray(images) ||
          images.length === 0 ||
          !Array.isArray(tourPlan) ||
          tourPlan.length === 0
        ) {
          return res.status(400).json({ error: "Missing or invalid fields." });
        }

        const newPackage = {
          title,
          images,
          description,
          tourType,
          duration,
          price,
          tourPlan,
          createdAt: new Date(),
        };

        const result = await packagesCollection.insertOne(newPackage);

        res.status(201).json({
          message: "Package created successfully.",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Failed to add package:", error);
        res.status(500).json({ error: "Internal server error." });
      }
    });

    // POST: Add a new story
    // POST: Add a new story
    app.post("/stories", verifyJWT, async (req, res) => {
      try {
        const {
          title,
          text,
          images,
          userEmail,
          userName,
          userPhoto,
          createdAt,
        } = req.body;

        // Validate required fields
        if (
          !title ||
          !text ||
          !images ||
          !userEmail ||
          !userName ||
          !userPhoto
        ) {
          return res.status(400).json({ error: "Missing required fields" });
        }

        const storyData = {
          title,
          text,
          images, // Array of image URLs
          userEmail,
          userName,
          userPhoto,
          createdAt: createdAt || new Date().toISOString(),
        };

        const result = await storiesCollection.insertOne(storyData);

        res.status(201).json({
          insertedId: result.insertedId,
          message: "Story added successfully",
        });
      } catch (error) {
        console.error("Error adding story:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // join as tour guide application
    app.post("/guide-applications", verifyJWT, async (req, res) => {
      const application = req.body;
      try {
        const result = await applicationsCollection.insertOne(application);
        res.send(result);
      } catch (err) {
        console.error("Error adding guide application:", err);
        res.status(500).send({ error: "Failed to submit application" });
      }
    });

app.post("/users", verifyJWT, async (req, res) => {
  const userData = req.body;
  const query = { email: userData.email };

  try {
    const existingUser = await usersCollection.findOne(query);

    let updateDoc;

    if (existingUser) {
      // If user already exists, update only name/photo/lastLogin
      updateDoc = {
        $set: {
          name: userData.name,
          photo: userData.photo,
          lastLogin: new Date(),
        },
      };
    } else {
      // If new user, assign role = tourist
      updateDoc = {
        $set: {
          name: userData.name,
          photo: userData.photo,
          role: "tourist",
          lastLogin: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      };
    }

    const options = { upsert: true };

    const result = await usersCollection.updateOne(query, updateDoc, options);
    const updatedUser = await usersCollection.findOne(query);
    res.send({ success: true, user: updatedUser });

  } catch (error) {
    console.error("❌ Error saving user:", error);
    res.status(500).send({ success: false, message: "Failed to save user", error });
  }
});


    // booking api to book a package
    app.post("/bookings", verifyJWT, async (req, res) => {
      const bookingData = req.body;
      try {
        const result = await bookingsCollection.insertOne(bookingData);
        res.send(result);
      } catch (err) {
        res
          .status(500)
          .send({ error: "Failed to book tour", details: err.message });
      }
    });

    // POST route to save payment history
    app.post("/payment-history", verifyJWT, async (req, res) => {
      try {
        const paymentData = req.body;

        // Simple validation (you can add more)
        if (
          !paymentData.bookingId ||
          !paymentData.amount ||
          !paymentData.transactionId ||
          !paymentData.email
        ) {
          return res
            .status(400)
            .json({ message: "Missing required payment data" });
        }

        // Insert payment record into the collection
        const result = await paymentsCollection.insertOne({
          ...paymentData,
          createdAt: new Date(),
        });

        if (result.insertedId) {
          return res.status(201).json({
            message: "Payment history saved successfully",
            id: result.insertedId,
          });
        } else {
          return res
            .status(500)
            .json({ message: "Failed to save payment history" });
        }
      } catch (error) {
        console.error("Error saving payment history:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // all get route here ---------------------------------------------------------

    // get single user data with email
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const user = await usersCollection.findOne({ email });
        if (user) {
          res.send(user);
        } else {
          res.status(404).send({ message: "User not found" });
        }
      } catch (error) {
        res.status(500).send({ message: "Server error", error });
      }
    });

    // GET assigned tours for a guide by guide email
    app.get("/assigned-tours", verifyJWT, async (req, res) => {
      const guideEmail = req.query.guideEmail;
      if (!guideEmail)
        return res.status(400).send({ error: "guideEmail is required" });

      try {
        // Find tours assigned to this guide (filter by tourGuide field)
        const assignedTours = await bookingsCollection
          .find({ tourGuide: guideEmail })
          .toArray();

        res.send(assignedTours);
      } catch (error) {
        console.error("Failed to get assigned tours:", error);
        res.status(500).send({ error: "Failed to fetch assigned tours" });
      }
    });

    // GET /bookings?email=user@example.com
    app.get("/bookings", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const result = await bookingsCollection
        .find({ touristEmail: email })
        .toArray();
      res.send(result);
    });

    app.get("/bookings/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid booking ID." });
      }

      try {
        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!booking) {
          return res.status(404).json({ error: "Booking not found." });
        }

        res.status(200).json(booking);
      } catch (error) {
        console.error("Error fetching booking:", error);
        res.status(500).json({ error: "Internal server error." });
      }
    });

    // GET /packages - fetch all packages
    app.get("/packages", async (req, res) => {
      try {
        const packages = await packagesCollection.find({}).toArray();
        res.status(200).json(packages);
      } catch (error) {
        console.error("Failed to get packages:", error);
        res.status(500).json({ error: "Failed to fetch packages" });
      }
    });

    // Express route to get 3 random packages
    app.get("/packages/random", async (req, res) => {
      try {
        const result = await packagesCollection
          .aggregate([{ $sample: { size: 3 } }])
          .toArray();

        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to fetch random packages" });
      }
    });

    // single package details route
    app.get("/packages/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const result = await packagesCollection.findOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      } catch (err) {
        res.status(500).send({ error: "Something went wrong" });
      }
    });

    //  Get all users with role
    app.get("/users", async (req, res) => {
      const role = req.query.role;
      const query = role ? { role } : {};
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // Backend - GET /admin/users
    app.get("/admin/users", verifyJWT, async (req, res) => {
      const { page = 1, limit = 10, role, search } = req.query;
      const parsedPage = parseInt(page);
      const parsedLimit = parseInt(limit);

      const filter = {};
      if (role) filter.role = role;
      if (search) {
        filter.$or = [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ];
      }

      const total = await usersCollection.countDocuments(filter);
      const users = await usersCollection
        .find(filter)
        .skip((parsedPage - 1) * parsedLimit)
        .limit(parsedLimit)
        .toArray();

      res.json({ users, total });
    });

    // get all payment history
    app.get("/payment-history", verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).json({ message: "Email required" });

      try {
        const history = await paymentsCollection
          .find({ email })
          .sort({ date: -1 })
          .toArray();
        res.json(history);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // get all stories
    app.get("/stories", async (req, res) => {
      try {
        const stories = await storiesCollection.find({}).toArray();
        res.send(stories);
      } catch (error) {
        console.error("Failed to fetch stories:", error);
        res.status(500).send({ error: "Failed to fetch stories" });
      }
    });

    // GET /stories?limit=4&random=true
    app.get("/stor", async (req, res) => {
      try {
        const { limit, random } = req.query;
        const parsedLimit = parseInt(limit) || 0;

        let stories;

        if (random === "true") {
          stories = await storiesCollection
            .aggregate([{ $sample: { size: parsedLimit || 4 } }])
            .toArray(); // 🛠️ FIXED
        } else {
          stories = await storiesCollection
            .find()
            .sort({ createdAt: -1 })
            .limit(parsedLimit)
            .toArray(); // 🛠️ FIXED
        }

        res.status(200).json(stories);
      } catch (error) {
        console.error("Failed to fetch stories:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // get stories via email
    app.get("/story", verifyJWT, async (req, res) => {
      const userEmail = req.query.email;

      try {
        // If email is provided, return only that user's stories
        const query = userEmail ? { userEmail } : {};
        const stories = await storiesCollection.find(query).toArray();

        res.send(stories);
      } catch (err) {
        console.error("Error fetching stories:", err);
        res.status(500).send({ error: "Failed to fetch stories" });
      }
    });

    // GET /guides/random?limit=6
    app.get("/guides/random", async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 6;
        const guides = await usersCollection
          .aggregate([
            { $match: { role: "guide" } },
            { $sample: { size: limit } },
          ])
          .toArray();

        res.send(guides);
      } catch (err) {
        console.error("Error fetching random guides:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // GET: View user public profile by email
    app.get("/users/profile/:email", verifyJWT, async (req, res) => {
      try {
        const email = req.params.email;
        if (!email) {
          return res.status(400).json({ error: "Email is required" });
        }

        const user = await usersCollection.findOne(
          { email },
          {
            projection: {
              name: 1,
              email: 1,
              photoURL: 1,
              createdAt: 1,
              bio: 1,
              location: 1,
              // Add more public fields if needed
            },
          }
        );

        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        res.json(user);
      } catch (error) {
        console.error("Error fetching user profile:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // get total payments admin
    app.get("/admin/stats/payments", verifyJWT, async (req, res) => {
      const email = req.query.email;

      const user = await usersCollection.findOne({ email });

      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Access denied: Not an admin" });
      }

      const result = await paymentsCollection
        .aggregate([
          { $group: { _id: null, totalPayments: { $sum: "$amount" } } },
        ])
        .toArray();

      res.send({ totalPayments: result[0]?.totalPayments || 0 });
    });

    // get total user and guide admin
    app.get("/admin/users-by-role", verifyJWT, async (req, res) => {
      try {
        const [guides, tourists] = await Promise.all([
          usersCollection.find({ role: "guide" }).toArray(),
          usersCollection.find({ role: "tourist" }).toArray(),
        ]);

        res.status(200).json({
          guides,
          tourists,
        });
      } catch (err) {
        console.error("❌ Failed to fetch users by role:", err);
        res.status(500).json({ message: "Server error", error: err.message });
      }
    });

    // ✅ Get all tour guide applications
    app.get("/admin/guide-candidates", verifyJWT, async (req, res) => {
      const candidates = await applicationsCollection.find().toArray();
      res.send(candidates);
    });

    // all delete router here------------------------------------------------------
    // DELETE /bookings/:id
    app.delete("/bookings/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const result = await bookingsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // delete stories
    app.delete("/stories/:id", verifyJWT, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };

        const result = await storiesCollection.deleteOne(query);

        if (result.deletedCount > 0) {
          res.send({ success: true, deletedCount: result.deletedCount });
        } else {
          res.status(404).send({ success: false, message: "Story not found" });
        }
      } catch (err) {
        console.error("Failed to delete story:", err);
        res.status(500).send({ success: false, message: "Server error" });
      }
    });

    // ✅ Delete guide application
    app.delete("/admin/guide-candidates/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const result = await applicationsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // DELETE package
    app.delete("/packages/:id", verifyJWT, async (req, res) => {
      const { id } = req.params;
      await packagesCollection.deleteOne({ _id: new ObjectId(id) });
      res.json({ message: "Package deleted" });
    });

    // all patch route here------------------------------------------------------------
    app.patch("/bookings/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const updateData = req.body; // e.g., { status: "confirmed" }

      try {
        const result = await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Booking not found" });
        }

        res.json({ message: "Booking updated successfully" });
      } catch (error) {
        console.error("Error updating booking:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // update user data
    app.patch("/users/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const updatedData = req.body;

      const result = await usersCollection.updateOne(
        { email },
        { $set: updatedData }
      );

      res.send(result);
    });

    // PATCH update tour status by tour ID
    app.patch("/assigned-tours/:id", verifyJWT, async (req, res) => {
      const tourId = req.params.id;
      const { status } = req.body;

      // Validate allowed statuses (update if your app uses different ones)
      const allowedStatuses = [
        "pending",
        "in-review",
        "accepted",
        "rejected",
        "confirmed",
      ];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).send({ error: "Invalid status value" });
      }

      try {
        const updateResult = await bookingsCollection.updateOne(
          { _id: new ObjectId(tourId) },
          { $set: { status } }
        );

        if (updateResult.matchedCount === 0) {
          return res.status(404).send({ error: "Assigned tour not found" });
        }

        res.send({ success: true, message: "Status updated successfully" });
      } catch (error) {
        console.error("Failed to update assigned tour status:", error);
        res.status(500).send({ error: "Failed to update status" });
      }
    });

    // PATCH user role for admin
    app.patch("/admin/users/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
      );
      res.send(result);
    });

    // ✅ Accept application (update user role)
    app.patch("/admin/updateRole/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const { role } = req.body;
      console.log("the email", email);

      try {
        const result = await usersCollection.updateOne(
          { email },
          { $set: { role } }
        );

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to update user role" });
      }
    });

    // all put route here ----------------------------------------------------------
    // Update story by ID
    app.put("/stories/:id", verifyJWT, async (req, res) => {
      try {
        const { id } = req.params;
        const {
          title,
          text,
          removedImages = [],
          newImageURLs = [],
          userName,
          userPhoto,
        } = req.body;

        const story = await storiesCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!story) return res.status(404).json({ error: "Story not found" });

        const updatedImages = story.images
          .filter((img) => !removedImages.includes(img))
          .concat(newImageURLs);

        const result = await storiesCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              title,
              text,
              images: updatedImages,
              userName,
              userPhoto,
            },
          }
        );

        res.send(result);
      } catch (err) {
        console.error("Error updating story:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // PUT update package
    app.put("/packages/:id", verifyJWT, async (req, res) => {
      const { id } = req.params;
      const updatedData = req.body;
      await packagesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );
      res.json({ message: "Package updated" });
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("tripTale server is running.");
});

app.listen(port, () => {
  console.log(`tripTale server is running on port ${port}`);
});
