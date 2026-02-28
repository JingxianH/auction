# Tentative Project Schedule


## Phase 1: Backend API Development (Mar 1 – 10)
* **Auction Management (Jingxian):** Implement endpoints for item creation, image handling, auction duration, and reserve pricing.
* **User & Bid Management (Felipe):** Develop account provisioning, user following, bid processing logic, and an auction status notification system.


## Phase 2: Cloud Infrastructure & Automation (Mar 11 – 20)
* **Orchestration & HA (Jingxian):** Provision DigitalOcean resources and deploy the app via Kubernetes. Implement and validate failover mechanisms for API pods and the database.
* **CI/CD Pipeline (Felipe):** Architect GitHub Actions workflows for automated container building and continuous deployment to the cluster.


## Phase 3: System Validation & Wrap-Up (Mar 21 – 25)
* **Testing & Polish (Joint):** Execute active failover testing scenarios, finalize system documentation, and prepare the final presentation materials.


---


# Initial Independent Reasoning
Before consulting AI, we established our primary learning objective: designing a real-world application capable of handling high production traffic with strict high availability (HA) and reliability. The system must remain available during unexpected node failures, implement robust failover strategies, and guarantee that persisted data is never lost or corrupted during an outage.


# Architecture Choice
We will containerize our backend APIs using Docker and orchestrate them with Kubernetes to run multiple stateless replica pods, ensuring high availability. We chose Kubernetes over Docker Swarm because, while Swarm is simpler to set up, Kubernetes is the industry standard used by major tech companies to scale applications. It provides powerful lifecycle management features, such as automated rollouts, self-healing, and advanced traffic routing, which are essential for our HA goals.


# Anticipated Challenges
A major challenge is Kubernetes' steep learning curve, especially since it is introduced later in the ECE1779 course. We will need to dedicate time to mastering core concepts like Deployments, Services, and Persistent Volumes. Secondly, validating our HA and failover goals will be complex. We must design active failure scenarios—such as manually terminating server pods or simulating database crashes—to verify that the system successfully reroutes traffic and that persistent data remains intact.


# Early Development Approach
* **Local Development:** We will build the core functional backend APIs and test them locally using Docker Compose to ensure container compatibility.
* **Cloud Provisioning:** Once tested, we will provision infrastructure on DigitalOcean (likely utilizing their managed Kubernetes service) to simplify control plane management.
* **Orchestration & HA:** We will deploy the application via Kubernetes, configuring replica sets for server failover and setting up database replication with automated backups.
* **Automation:** Finally, we will implement a CI/CD pipeline using GitHub Actions to automatically build our Docker images, push them to a container registry, and deploy updates to the cluster.


# AI Assistance Disclosure
We used AI primarily for grammar correction, readability enhancements, and initial project scoping. After using AI to evaluate our original idea—a complex AI agent integrating third-party APIs like Google Maps—against the project rubric, we realized the scope was too broad. We then prompted AI for alternative concepts and selected a cloud-native auction platform. This choice offers realistic business value and inherently demands the high availability required for a robust cloud infrastructure project.


The "Key Features" and "Initial Independent Reasoning" sections were developed entirely without AI influence. Our team held collaborative design meetings to brainstorm functional requirements, define the project scope, and select a technology stack aligned with our learning objectives. These sections accurately document our original architectural decisions and engineering thought processes.


